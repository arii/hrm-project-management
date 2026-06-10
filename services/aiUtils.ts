
/**
 * Clean a string that might contain Markdown JSON code blocks
 */
export const cleanJsonString = (str: string): string => {
  return str.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
};

/**
 * Retry helper for transient API errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>, 
  maxRetries = 3, 
  initialDelay = 1000,
  loggerName = 'Service'
): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      
      // Determine transient nature and potential retry delay
      const errorMessage = e.message || '';
      
      // Attempt to extract delay from JSON error body if it exists
      let suggestedDelay = 0;
      if (errorMessage.includes('429')) {
        try {
          const jsonMatch = errorMessage.match(/\{.*\}/);
          if (jsonMatch) {
            const errorBody = JSON.parse(jsonMatch[0]);
            // Look for RetryInfo in Google API error format
            const retryInfo = errorBody.details?.find((d: any) => d['@type']?.includes('RetryInfo'));
            if (retryInfo && retryInfo.retryDelay) {
              // Convert "Xs" string to milliseconds
              const delaySeconds = parseFloat(retryInfo.retryDelay);
              suggestedDelay = delaySeconds * 1000;
            }
          }
        } catch (parseError) {
          console.warn(`[${loggerName}] Failed to parse RetryInfo from error`, parseError);
        }
      }

      if (suggestedDelay > 30000 && maxRetries < 5) {
        throw new Error(`Rate limit exceeded. Try again in ${Math.round(suggestedDelay / 1000)} seconds. Detail: ${errorMessage.substring(0, 150)}`);
      }

      const isTransient = 
        errorMessage.includes('503') || 
        errorMessage.includes('UNAVAILABLE') || 
        errorMessage.includes('429') ||
        errorMessage.includes('Failed to fetch') ||
        e.name === 'AbortError';

      if (!isTransient || i === maxRetries) throw e;
      
      // Use suggested delay if 429, otherwise exponential backoff
      const delay = suggestedDelay > 0 
        ? suggestedDelay + (Math.random() * 1000) // jitter
        : initialDelay * Math.pow(2, i);

      // Only warn on second attempt onwards to keep console clean for single-request flutter
      if (i > 0 || suggestedDelay > 0) {
        console.warn(`[${loggerName}] Transient error (attempt ${i + 1}/${maxRetries + 1}): ${errorMessage.substring(0, 100)}... Retrying in ${Math.round(delay)}ms...`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
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
