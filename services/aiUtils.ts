
/**
 * Clean a string that might contain Markdown JSON code blocks
 */
export const cleanJsonString = (str: string): string => {
  return str.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
};

class ConcurrencyQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];
  private maxConcurrency = 1; // Safely serialize Gemini API execution on free-tier keys
  private lastRequestTime = 0;
  private minSpacingMs = 1500; // Minimum delay between starting two requests to avoid burst rate limits

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minSpacingMs) {
        await new Promise(resolve => setTimeout(resolve, this.minSpacingMs - elapsed));
      }
      this.activeCount++;
      this.lastRequestTime = Date.now();
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    }).then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minSpacingMs) {
        await new Promise(resolve => setTimeout(resolve, this.minSpacingMs - elapsed));
      }
      this.lastRequestTime = Date.now();
    });
  }

  release(): void {
    this.activeCount--;
    if (this.queue.length > 0) {
      this.activeCount++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const geminiQuotaQueue = new ConcurrencyQueue();

/**
 * Retry helper for transient API errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>, 
  maxRetries = 3, 
  initialDelay = 1000,
  loggerName = 'Service',
  silent = false
): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    // Wait for slot allocation from the queue
    await geminiQuotaQueue.acquire();
    try {
      const result = await fn();
      return result;
    } catch (e: any) {
      lastError = e;
      
      // Determine transient nature and potential retry delay
      const errorMessage = typeof e === 'object' && e !== null ? (e.message || JSON.stringify(e)) : String(e);
      const is429 = errorMessage.includes('429') || 
                    errorMessage.includes('RESOURCE_EXHAUSTED') || 
                    errorMessage.includes('quota') ||
                    e.status === 429 || 
                    e.statusCode === 429;
      
      const isBillingIssue = errorMessage.includes('spending cap') || errorMessage.includes('billing');
      
      let suggestedDelay = 0;
      if (is429 && !isBillingIssue) {
        try {
          const details = e.details || e.error?.details;
          if (Array.isArray(details)) {
            const retryInfo = details.find((d: any) => d['@type']?.includes('RetryInfo') || d.retryDelay);
            if (retryInfo && retryInfo.retryDelay) {
              suggestedDelay = parseFloat(retryInfo.retryDelay) * 1000;
            }
          }

          if (!suggestedDelay) {
            const jsonMatch = errorMessage.match(/\{.*\}/);
            if (jsonMatch) {
              const errorBody = JSON.parse(jsonMatch[0]);
              const retryInfo = errorBody.details?.find((d: any) => d['@type']?.includes('RetryInfo') || d.retryDelay) || 
                                errorBody.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo') || d.retryDelay);
              if (retryInfo && retryInfo.retryDelay) {
                suggestedDelay = parseFloat(retryInfo.retryDelay) * 1000;
              }
            }
          }
        } catch (parseError) {
          console.warn(`[${loggerName}] Failed to parse RetryInfo from error`, parseError);
        }

        // Apply default backoff for 429 errors if no custom delay was extracted
        if (!suggestedDelay) {
          suggestedDelay = 5000 * Math.pow(1.5, i); // 5s, 7.5s, 11.25s etc
        }
      }

      if (suggestedDelay > 30000 && maxRetries < 5) {
        throw new Error(`Rate limit exceeded. Try again in ${Math.round(suggestedDelay / 1000)} seconds. Detail: ${errorMessage.substring(0, 150)}`);
      }

      const isTransient = 
        errorMessage.includes('503') || 
        errorMessage.includes('UNAVAILABLE') || 
        (is429 && !isBillingIssue) ||
        errorMessage.includes('Failed to fetch') ||
        e.name === 'AbortError';

      if (!isTransient || i === maxRetries) throw e;
      
      const delay = suggestedDelay > 0 
        ? suggestedDelay + (Math.random() * 1000) // jitter
        : initialDelay * Math.pow(2, i);

      if (!silent && (i > 0 || suggestedDelay > 0)) {
        console.warn(`[${loggerName}] Rate limit/Transient error (attempt ${i + 1}/${maxRetries + 1}): ${errorMessage.substring(0, 100)}... Retrying in ${Math.round(delay)}ms...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      // Must release lock to let subsequent requests execute
      geminiQuotaQueue.release();
    }
  }
  throw lastError;
}

const IGNORED_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'mix.lock',
  'poetry.lock',
];

const IGNORED_EXTENSIONS = [
  '.map',
  '.min.js',
  '.min.css',
];

/**
 * Removes sections from a git diff that belong to high-noise files (lockfiles, minified files, maps).
 * Essential for reducing token usage and focusing AI on actual code changes.
 */
export const pruneDiff = (diff: string): string => {
  if (!diff) return "";
  
  // Split the diff into file sections
  // Each section starts with "diff --git"
  const sections = diff.split(/^diff --git /m);
  
  if (sections.length <= 1) return diff;

  const header = sections[0]; // Usually empty
  const prunedSections = sections.slice(1).filter(section => {
    const lines = section.split('\n');
    const firstLine = lines[0];
    
    // First line looks like: a/package.json b/package.json
    // We care about the target file (b/)
    const pathMatch = firstLine.match(/b\/(.+?)(?:\s|$)/);
    if (!pathMatch) return true;

    const path = pathMatch[1].trim();
    const fileName = path.split('/').pop()?.toLowerCase() || "";

    const isIgnoredFile = IGNORED_FILES.some(f => f.toLowerCase() === fileName);
    const isIgnoredExtension = IGNORED_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));

    // Also skip huge binary deletions/additions if present in textual form
    if (section.includes('GIT binary patch') || section.includes('Binary files differ')) {
      return false;
    }

    return !isIgnoredFile && !isIgnoredExtension;
  });

  return header + prunedSections.map(s => 'diff --git ' + s).join('');
};
