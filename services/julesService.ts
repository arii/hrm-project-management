
import { JulesSession, JulesSource } from '../types';
import { storage, StorageKeys } from './storageService';
import { withRetry } from './aiUtils';

const JULES_API_BASE = '/api/jules';
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Common locations to try for Jules API
const JULES_LOCATIONS = ['global', 'us-central1', 'us-east1', 'europe-west1'];

const clearJulesCache = () => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(StorageKeys.JULES_CACHE)) {
      localStorage.removeItem(key);
    }
  }
};

let useDirectJules = false;

// Auto-detect environments where we know the local proxy is physically not there
if (typeof window !== 'undefined') {
  const host = window.location.hostname;
  if (
    host.includes('vercel.app') || 
    host.includes('netlify.app') || 
    host.includes('github.io') || 
    host.includes('pages.dev')
  ) {
    // Let the edge network rewrite rule do the work; do not switch to direct fetching
    console.log(`[JulesService] Detected static hosting platform (${host}). Utilizing native routing configurations.`);
    useDirectJules = false; 
  }
}

const request = async <T>(endpoint: string, apiKey: string, options: RequestInit = {}, forceRefresh = false): Promise<T> => {
  const runRequest = async (): Promise<T> => {
    if (!apiKey || !apiKey.trim()) {
      throw new Error("Jules API Key is missing. Please check your settings.");
    }

    const isGet = !options.method || options.method === 'GET';
    const cacheKey = `${StorageKeys.JULES_CACHE}_${endpoint}`;

    if (isGet && !forceRefresh) {
      const cached = storage.get<T>(cacheKey);
      if (cached) return cached;
    }

    const headers: HeadersInit = {
      'X-Goog-Api-Key': apiKey.trim(),
      ...options.headers,
    };

    if (!isGet && !headers['Content-Type']) {
      // @ts-ignore
      headers['Content-Type'] = 'application/json';
    }

    const fullUrl = useDirectJules 
      ? `https://jules.googleapis.com/v1alpha/${endpoint}` 
      : `${JULES_API_BASE}/${endpoint}`;

    console.log(`[JulesService] Requesting ${fullUrl} (method: ${options.method || 'GET'})`);
    
    // Implement a 20s timeout for network reliability
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal
      });
    } catch (e: any) {
      console.error(`[JulesService] Fetch failed for ${fullUrl}:`, e);
      if (e.name === 'AbortError') {
        throw new Error(`Jules API Request timed out (20s). The network might be slow or unstable.`);
      }
      if (!useDirectJules) {
        console.warn(`[JulesService] Proxy path ${fullUrl} failed. Switching to direct Jules API routing...`);
        useDirectJules = true;
        return runRequest();
      }
      if (e.message === 'Failed to fetch') {
        throw new Error(`Network error: Failed to reach Jules API. Check your internet connection or if the URL is blocked. (Target: ${fullUrl})`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();

    // Check if we got HTML on a proxy request
    if (!useDirectJules && (rawText.includes('<!DOCTYPE html>') || rawText.includes('<html') || response.status === 404)) {
      console.warn(`[JulesService] Proxy endpoint ${fullUrl} returned HTML/404. Switching to direct Jules API routing...`);
      useDirectJules = true;
      return runRequest();
    }

    if (!response.ok) {
      let errorMessage = `Jules API Error: ${response.status}`;
      try {
        const errorBody = JSON.parse(rawText);
        if (errorBody.error?.message) errorMessage = errorBody.error.message;
      } catch (e) {
        if (rawText.trim().length > 0) {
          errorMessage = `Jules API [${response.status}]: ${rawText.trim().substring(0, 150)}`;
        }
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204 || (!rawText.trim() && response.status === 200)) {
      if (!isGet) clearJulesCache();
      return {} as T;
    }

    let data: T;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      const preview = rawText.trim().substring(0, 200);
      console.error("[JulesService] JSON Parse Error on status", response.status, ":", rawText);
      
      if (!useDirectJules && (rawText.includes('<!DOCTYPE html>') || rawText.includes('<html'))) {
         console.warn(`[JulesService] Invalid JSON (HTML) from proxy. Retrying with direct Jules API routing...`);
         useDirectJules = true;
         return runRequest();
      }

      throw new Error(`Jules API returned invalid JSON (Status: ${response.status}). Preview: ${preview}...`);
    }

    if (isGet) {
      storage.setCached(cacheKey, data, CACHE_DURATION);
    } else {
      clearJulesCache();
      storage.clearCaches(); 
    }

    return data;
  };

  return await withRetry(runRequest, 3, 1000, 'JulesService');
};

/**
 * Returns a valid URL for the Jules UI for a given session.
 */
export const getSessionUrl = (sessionNameOrId: string): string => {
  if (!sessionNameOrId) return 'https://jules.google.com/';
  // Session name is usually "sessions/123" or just "123"
  const id = sessionNameOrId.includes('/') ? sessionNameOrId.split('/').pop() : sessionNameOrId;
  if (!id) return 'https://jules.google.com/';
  // Format requested by user: https://jules.google.com/session/{id}/
  return `https://jules.google.com/session/${id}/`;
};

export const listSources = async (apiKey: string, filter?: string): Promise<JulesSource[]> => {
  const query = filter ? `?filter=${encodeURIComponent(filter)}` : '';
  
  // Try common paths in parallel to speed up discovery on slow networks
  const priorityPaths = [
    `sources${query}`,
    `projects/-/locations/global/sources${query}`,
    `locations/global/sources${query}`
  ];

  try {
    const results = await Promise.allSettled(
      priorityPaths.map(path => request<{ sources: JulesSource[] }>(path, apiKey, { headers: { 'X-Ignore-Error': 'true' } }))
    );

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value.sources && res.value.sources.length > 0) {
        return res.value.sources;
      }
    }
  } catch (e) {}

  // Fallback to searching other locations sequentially if priority paths failed
  const remainingLocations = JULES_LOCATIONS.filter(l => l !== 'global');
  for (const location of remainingLocations) {
    const parents = [
      `projects/-/locations/${location}`,
      `locations/${location}`
    ];

    for (const parent of parents) {
      try {
        const data = await request<{ sources: JulesSource[] }>(`${parent}/sources${query}`, apiKey, { headers: { 'X-Ignore-Error': 'true' } });
        if (data.sources && data.sources.length > 0) return data.sources;
      } catch (e) {}
    }
  }

  console.error(`[JulesService] All source listing paths failed.`);
  return [];
};

export const getSession = async (apiKey: string, sessionName: string, forceRefresh = false): Promise<JulesSession> => {
  let endpoint = sessionName;
  if (!sessionName.startsWith('projects/') && 
      !sessionName.startsWith('sessions/') && 
      !sessionName.startsWith('locations/')) {
    endpoint = `sessions/${sessionName}`;
  }
  return request<JulesSession>(endpoint, apiKey, {}, forceRefresh);
};

export const listSessions = async (apiKey: string, forceRefresh = false): Promise<JulesSession[]> => {
  let allSessions: JulesSession[] = [];
  let nextToken: string | undefined = undefined;
  let pages = 0;
  
  const parents: string[] = ['']; // root first
  
  for (const location of JULES_LOCATIONS) {
    parents.push(`projects/-/locations/${location}`);
    parents.push(`locations/${location}`);
  }

  for (const parent of parents) {
    try {
      nextToken = undefined;
      pages = 0;
      allSessions = [];
      
      const sessionPath = parent ? `${parent}/sessions` : 'sessions';
      
      do {
        const query = (nextToken ? `?pageToken=${nextToken}` : '');
        const data = await request<{ sessions: JulesSession[], nextPageToken?: string }>(
          `${sessionPath}${query}`, 
          apiKey, 
          { headers: { 'X-Ignore-Error': 'true' } }, 
          forceRefresh
        );
        
        if (data.sessions) {
          allSessions = [...allSessions, ...data.sessions];
        }
        nextToken = data.nextPageToken;
        pages++;
      } while (nextToken && pages < 10);

      if (allSessions.length > 0) return allSessions;
    } catch (e: any) {
      if (!e.message.includes('404')) {
        console.warn(`[JulesService] Failed to list sessions with parent "${parent}": ${e.message}`);
      }
    }
  }

  return allSessions;
};

/**
 * Enriches a list of sessions with full details by fetching each individually.
 * Opt-in for performance.
 */
export const enrichSessionsWithDetails = async (apiKey: string, sessions: JulesSession[]): Promise<JulesSession[]> => {
  // Fetch details for the top N most recent sessions to avoid hitting limits or being too slow
  const limit = 3;
  const recent = sessions.slice(0, limit);
  
  const enriched = await Promise.all(
    recent.map(async (s) => {
      try {
        return await getSession(apiKey, s.name);
      } catch (e) {
        console.warn(`[JulesService] Failed to enrich session ${s.name}:`, e);
        return s;
      }
    })
  );

  // Return enriched sessions joined with the rest of the list
  return [...enriched, ...sessions.slice(limit)];
};

export const createSession = async (
  apiKey: string, 
  prompt: string, 
  sourceId: string, 
  branch: string,
  title?: string
): Promise<JulesSession> => {
  if (!branch) {
    console.error("[JulesService] Attempted to create session without branch context.");
    throw new Error("Branch context is required to create a Jules session.");
  }

  // Parse location and relative source ID
  let location = 'global';
  let relativeSourceId = sourceId;

  const projLocMatch = sourceId.match(/projects\/[^/]+\/locations\/([^/]+)\/sources\/(.+)$/);
  const locMatch = sourceId.match(/locations\/([^/]+)\/sources\/(.+)$/);
  const srcMatch = sourceId.match(/^sources\/(.+)$/);

  if (projLocMatch) {
    location = projLocMatch[1];
    relativeSourceId = projLocMatch[2];
  } else if (locMatch) {
    location = locMatch[1];
    relativeSourceId = locMatch[2];
  } else if (srcMatch) {
    relativeSourceId = srcMatch[1];
  } else if (sourceId.includes('/sources/')) {
    const parts = sourceId.split('/sources/');
    relativeSourceId = parts[1];
    if (parts[0].includes('locations/')) {
      const locParts = parts[0].split('locations/');
      location = locParts[1].split('/')[0];
    }
  }

  relativeSourceId = relativeSourceId.startsWith('/') ? relativeSourceId.substring(1) : relativeSourceId;

  // Generate candidates to try in priority order
  interface SessionCandidate {
    parent: string;
    source: string;
    description: string;
  }

  const candidates: SessionCandidate[] = [];

  // 1. Try root sessions first (most standard and recommended for global setups)
  // Candidate A: Root sessions with unmodified original sourceId (e.g. projects/-/locations/global/sources/...)
  candidates.push({
    parent: '',
    source: sourceId,
    description: `root with original source ID "${sourceId}"`
  });

  // Candidate B: Root sessions with "sources/..." relative path
  candidates.push({
    parent: '',
    source: relativeSourceId.startsWith('sources/') ? relativeSourceId : `sources/${relativeSourceId}`,
    description: `root with sources prefix "sources/${relativeSourceId}"`
  });

  // Candidate C: Root sessions with clean relative source ID
  candidates.push({
    parent: '',
    source: relativeSourceId,
    description: `root with clean relative source "${relativeSourceId}"`
  });

  // 2. Location-prefixed fallbacks (just in case certain environments require location-specific routing)
  const targetLocations = [location, ...JULES_LOCATIONS.filter(l => l !== location)];

  for (const loc of targetLocations) {
    // A. locations/{loc} with locations-prefixed source
    candidates.push({
      parent: `locations/${loc}`,
      source: `locations/${loc}/sources/${relativeSourceId}`,
      description: `locations/${loc} with locations-prefixed source`
    });

    // B. locations/{loc} with original unmodified source
    candidates.push({
      parent: `locations/${loc}`,
      source: sourceId,
      description: `locations/${loc} with original source`
    });

    // C. projects/-/locations/{loc} with locations-prefixed source
    candidates.push({
      parent: `projects/-/locations/${loc}`,
      source: `projects/-/locations/${loc}/sources/${relativeSourceId}`,
      description: `projects/-/locations/${loc} with projects-prefixed source`
    });

    // D. projects/-/locations/{loc} with original unmodified source
    candidates.push({
      parent: `projects/-/locations/${loc}`,
      source: sourceId,
      description: `projects/-/locations/${loc} with original source`
    });
  }

  console.log(`[JulesService] Prepared ${candidates.length} session creation candidate(s) for relative ID "${relativeSourceId}"`);

  let lastError: any = null;

  for (const candidate of candidates) {
    const endpoint = candidate.parent ? `${candidate.parent}/sessions` : 'sessions';
    const payload: any = {
      sourceContext: {
        source: candidate.source,
        githubRepoContext: { 
          startingBranch: branch 
        }
      },
      prompt: prompt
    };

    if (title) payload.title = title;

    console.log(`[JulesService] Attempting session creation with candidate: ${candidate.description}`);

    try {
      return await request<JulesSession>(endpoint, apiKey, {
        method: 'POST',
        headers: { 'X-Ignore-Error': 'true' },
        body: JSON.stringify(payload)
      });
    } catch (error: any) {
      lastError = error;
      const errorString = error instanceof Error ? error.message : JSON.stringify(error);
      
      if (errorString.includes("Precondition check failed")) {
         throw new Error(`Jules Precondition Error: Likely branch "${branch}" is not found or not synced yet in source.`);
      }

      console.warn(`[JulesService] Creation rejected for candidate ${candidate.description}: ${errorString}`);
    }
  }

  const finalErrorString = lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
  console.error(`[JulesService] All session creation candidates failed. Last error: ${finalErrorString}`);
  throw lastError || new Error("Failed to create session: All endpoints and prefixes rejected.");
};

export const sendMessage = async (apiKey: string, sessionName: string, text: string): Promise<any> => {
  let endpoint = `${sessionName}:sendMessage`;
  if (!sessionName.startsWith('projects/') && 
      !sessionName.startsWith('sessions/') && 
      !sessionName.startsWith('locations/')) {
    endpoint = `sessions/${sessionName}:sendMessage`;
  }
  
  // Try various payload formats since v1alpha can be inconsistent
  const payloads = [
    { message: { text } },
    { message: text },
    { message: { parts: [{ text }] } },
    { message: { content: { parts: [{ text }] } } },
    { prompt: text },
    { query: text },
    { queryText: text },
    { userInput: text },
    { userInput: { text } },
    { request: text },
    { request: { text } },
    { contents: [{ parts: [{ text }] }] },
    { content: { parts: [{ text }] } },
    { contents: [{ role: 'user', parts: [{ text }] }] },
    { content: { role: 'user', parts: [{ text }] } },
    { text },
    { input: { text } },
    { input: text }
  ];

  let lastError: any = null;

  for (const payload of payloads) {
    try {
      console.log(`[JulesService] Attempting sendMessage with payload key: ${Object.keys(payload)[0]}`);
      return await request(endpoint, apiKey, {
        method: 'POST',
        headers: { 'X-Ignore-Error': 'true' },
        body: JSON.stringify(payload)
      });
    } catch (e: any) {
      lastError = e;
      const errorMsg = e.message.toLowerCase();
      // If error is not "Unknown name" or "Invalid JSON payload", it's probably a real 404, auth error, or quota
      if (!errorMsg.includes('unknown name') && 
          !errorMsg.includes('invalid json payload') && 
          !errorMsg.includes('field not found') &&
          !errorMsg.includes('invalid argument')) {
        throw e;
      }
      console.warn(`[JulesService] sendMessage rejected payload ${Object.keys(payload)[0]}: ${e.message.substring(0, 200)}`);
    }
  }
  
  throw lastError || new Error("Failed to send message: All payload formats rejected.");
};

export const deleteSession = async (apiKey: string, sessionName: string): Promise<void> => {
  let endpoint = sessionName;
  if (!sessionName.startsWith('projects/') && 
      !sessionName.startsWith('sessions/') && 
      !sessionName.startsWith('locations/')) {
    endpoint = `sessions/${sessionName}`;
  }
  await request<void>(endpoint, apiKey, { method: 'DELETE' });
  // Invalidate sessions list cache to ensure refresh on next load
  storage.remove(`${StorageKeys.JULES_CACHE}_sessions`);
};

export const findSourceForRepo = async (apiKey: string, repoName: string): Promise<string | null> => {
  if (!repoName) return null;
  
  try {
    // 0. Check for manual override first
    const manualSourceId = storage.getJulesSourceId();
    if (manualSourceId) {
      console.log(`[JulesService] Using manual source ID override: "${manualSourceId}"`);
      return manualSourceId;
    }

    const sources = await listSources(apiKey);
    if (sources.length === 0) {
      console.warn("[JulesService] No sources found in Jules account.");
      return null;
    }

    // Normalize target repo name
    const repoParts = repoName.split('/');
    const owner = repoParts.length > 1 ? repoParts[0].toLowerCase() : "";
    const repoOnly = repoParts[repoParts.length - 1].toLowerCase();
    
    // Helper to normalize strings for comparison
    // We try two versions: one with separators and one without (super clean)
    const normalizeWithSep = (s: string) => s.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
    const normalizeNoSep = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const nRepoOnly = normalizeWithSep(repoOnly);
    const nRepoOnlyClean = normalizeNoSep(repoOnly);
    const nFullRepo = normalizeWithSep(repoName);
    const nFullRepoClean = normalizeNoSep(repoName);
    
    console.log(`[JulesService] Matching repo "${repoName}" against ${sources.length} sources.`);

    // 1. HIGH-CONFIDENCE MATCHES
    let match = sources.find(s => {
      const sourceName = s.name.toLowerCase();
      const sourceDisplayName = (s.displayName || '').toLowerCase();
      const nSourceName = normalizeWithSep(sourceName);
      const nSourceNameClean = normalizeNoSep(sourceName);
      const nDisplayName = normalizeWithSep(sourceDisplayName);
      const nDisplayNameClean = normalizeNoSep(sourceDisplayName);
      
      // Suffix matches
      if (sourceName.endsWith(`/${repoName.toLowerCase()}`) || sourceName.endsWith(`/${repoOnly}`)) return true;
      if (sourceDisplayName === repoName.toLowerCase() || sourceDisplayName === repoOnly) return true;

      // Normalized matches (with hyphens/underscores)
      if (nSourceName.endsWith(nRepoOnly) || nDisplayName === nRepoOnly) return true;
      if (nSourceName.includes(nFullRepo) || nDisplayName.includes(nFullRepo)) return true;

      // Super clean matches (no separators - handles "tech-dancer" vs "techdancer")
      if (nSourceNameClean.endsWith(nRepoOnlyClean) || nDisplayNameClean === nRepoOnlyClean) return true;
      if (nSourceNameClean.includes(nFullRepoClean) || nDisplayNameClean.includes(nFullRepoClean)) return true;

      return false;
    });

    if (match) {
      console.log(`[JulesService] Auto-detected source: "${repoName}" -> "${match.name}"`);
      return match.name;
    } 

    // 2. BEST GUESS FALLBACK
    // If no match found in the list (or list empty), try common patterns.
    // We prioritize the short name (repoOnly) as it's more common in Jules IDs than owner/repo.
    const guessId = `sources/${repoOnly}`;
    console.warn(`[JulesService] No source matched "${repoName}". Falling back to guess: "${guessId}"`);
    return guessId;
  } catch (e) {
    console.error(`[JulesService] Error in findSourceForRepo for "${repoName}":`, e);
    // Even on error, try the best-guess as a last resort
    const fallback = repoName.includes('/') ? `sources/${repoName.toLowerCase()}` : `sources/${repoName.toLowerCase()}`;
    return fallback;
  }
};
