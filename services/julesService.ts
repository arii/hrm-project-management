
import { JulesSession, JulesSource } from '../types';
import { storage, StorageKeys } from './storageService';

const JULES_API_BASE = '/api/jules';
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

const clearJulesCache = () => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(StorageKeys.JULES_CACHE)) {
      localStorage.removeItem(key);
    }
  }
};

const request = async <T>(endpoint: string, apiKey: string, options: RequestInit = {}, forceRefresh = false): Promise<T> => {
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

  const fullUrl = `${JULES_API_BASE}/${endpoint}`;
  let response: Response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      headers,
    });
  } catch (e: any) {
    console.error(`[JulesService] Fetch failed for ${fullUrl}:`, e);
    if (e.message === 'Failed to fetch') {
      throw new Error(`Network error: Failed to reach Jules API. Check your internet connection or if the URL is blocked. (Target: ${fullUrl})`);
    }
    throw e;
  }

  if (!response.ok) {
    let errorMessage = `Jules API Error: ${response.status}`;
    try {
      const text = await response.text();
      try {
        const errorBody = JSON.parse(text);
        if (errorBody.error?.message) errorMessage = errorBody.error.message;
      } catch (e) {
        if (text.includes('<!DOCTYPE html>')) {
          errorMessage = `Jules API returned HTML (Status: ${response.status}). Potential endpoint mismatch or network error.`;
        } else if (text.trim().length > 0) {
          errorMessage = `Jules API [${response.status}]: ${text.trim().substring(0, 150)}`;
        }
      }
    } catch (e) {}
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    if (!isGet) clearJulesCache();
    return {} as T;
  }

  const rawText = await response.text();
  let data: T;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    const preview = rawText.trim().substring(0, 200);
    console.error("[JulesService] JSON Parse Error on status", response.status, ":", rawText);
    
    if (rawText.includes('<!DOCTYPE html>') || rawText.includes('<html')) {
       throw new Error(`Jules API returned HTML instead of JSON (Status: ${response.status}). This often means a proxy or authentication error.`);
    }
    
    if (rawText.trim().length === 0) {
       throw new Error(`Jules API returned an empty response (Status: ${response.status})`);
    }

    throw new Error(`Jules API returned invalid JSON (Status: ${response.status}). Preview: ${preview}...`);
  }

  if (isGet) {
    storage.setCached(cacheKey, data, CACHE_DURATION);
  } else {
    clearJulesCache();
    // Also clear GitHub cache if we likely caused a PR update
    storage.clearCaches(); 
  }

  return data;
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
  
  try {
    const data = await request<{ sources: JulesSource[] }>(`sources${query}`, apiKey);
    if (data.sources && data.sources.length > 0) return data.sources;
  } catch (e) {
    console.warn("[JulesService] Failed to list sources with standard path, trying fallback...");
  }

  try {
    // Try wildcard path which is common for multi-project API keys
    const data = await request<{ sources: JulesSource[] }>(`projects/-/locations/-/sources${query}`, apiKey);
    return data.sources || [];
  } catch (e) {
    console.error("[JulesService] Both standard and fallback source listing failed:", e);
    return [];
  }
};

export const getSession = async (apiKey: string, sessionName: string, forceRefresh = false): Promise<JulesSession> => {
  const endpoint = sessionName.startsWith('sessions/') ? sessionName : `sessions/${sessionName}`;
  return request<JulesSession>(endpoint, apiKey, {}, forceRefresh);
};

export const listSessions = async (apiKey: string, forceRefresh = false): Promise<JulesSession[]> => {
  let allSessions: JulesSession[] = [];
  let nextToken: string | undefined = undefined;
  let pages = 0;
  
  do {
    const query = nextToken ? `?pageToken=${nextToken}` : '';
    const data = await request<{ sessions: JulesSession[], nextPageToken?: string }>(`sessions${query}`, apiKey, {}, forceRefresh);
    if (data.sessions) {
      allSessions = [...allSessions, ...data.sessions];
    }
    nextToken = data.nextPageToken;
    pages++;
  } while (nextToken && pages < 10);

  return allSessions;
};

/**
 * Enriches a list of sessions with full details by fetching each individually.
 * Opt-in for performance.
 */
export const enrichSessionsWithDetails = async (apiKey: string, sessions: JulesSession[]): Promise<JulesSession[]> => {
  // Fetch details for the top N most recent sessions to avoid hitting limits or being too slow
  const limit = 15;
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
  branch: string, // Removed default to avoid assuming 'leader'
  title?: string
): Promise<JulesSession> => {
  if (!branch) {
    console.error("[JulesService] Attempted to create session without branch context.");
    throw new Error("Branch context is required to create a Jules session.");
  }

  const payload: any = {
    prompt,
    sourceContext: {
      source: sourceId,
      githubRepoContext: { startingBranch: branch }
    }
  };

  if (title) payload.title = title;

  console.log(`[JulesService] Creating session for source "${sourceId}" on branch "${branch}"...`);

  try {
    return await request<JulesSession>('sessions', apiKey, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error: any) {
    const errorString = error instanceof Error ? error.message : JSON.stringify(error);
    console.error(`[JulesService] Session creation failed. Source: ${sourceId}, Branch: ${branch}, Error: ${errorString}`, error);
    
    // Standardize error message for "Source context not found" which is common if branch is wrong
    if (errorString.includes("Source context not found")) {
      throw new Error(`Jules could not find branch "${branch}" in source "${sourceId}". Please verify the branch exists and is pushed to GitHub.`);
    }
    
    if (errorString.includes("Requested entity was not found")) {
      throw new Error(`Jules could not find the source entity "${sourceId}". This usually means the repository hasn't been indexed by Jules or the mapping is incorrect. Please check the 'Jules Source ID' in settings.`);
    }

    throw error;
  }
};

export const sendMessage = async (apiKey: string, sessionName: string, text: string): Promise<any> => {
  const endpoint = sessionName.startsWith('sessions/') ? `${sessionName}:sendMessage` : `sessions/${sessionName}:sendMessage`;
  return request(endpoint, apiKey, {
    method: 'POST',
    body: JSON.stringify({ prompt: text })
  });
};

export const deleteSession = async (apiKey: string, sessionName: string): Promise<void> => {
  const endpoint = sessionName.startsWith('sessions/') ? sessionName : `sessions/${sessionName}`;
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
