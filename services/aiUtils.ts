
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
      // 503 is service unavailable, often transient for Google APIs
      // 429 is rate limit (quota)
      // fetch often throws "Failed to fetch" for transient network drops
      const isTransient = 
        e.message?.includes('503') || 
        e.message?.includes('UNAVAILABLE') || 
        e.message?.includes('429') ||
        e.message?.includes('Failed to fetch') ||
        e.name === 'AbortError';

      if (!isTransient || i === maxRetries) throw e;
      
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`[${loggerName}] Transient error (attempt ${i + 1}/${maxRetries + 1}): ${e.message}. Retrying in ${delay}ms...`);
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
