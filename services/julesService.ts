
import { JulesSession, JulesSource } from '../types';
import { storage, StorageKeys } from './storageService';

const JULES_API_BASE = 'https://jules.googleapis.com/v1alpha';
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

const clearJulesCache = () => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(StorageKeys.JULES_CACHE)) {
      localStorage.removeItem(key);
    }
  }
};

const request = async <T>(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<T> => {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Jules API Key is missing. Please check your settings.");
  }

  const isGet = !options.method || options.method === 'GET';
  const cacheKey = `${StorageKeys.JULES_CACHE}_${endpoint}`;

  if (isGet) {
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
      const errorBody = await response.json();
      if (errorBody.error?.message) errorMessage = errorBody.error.message;
    } catch (e) {}
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    if (!isGet) clearJulesCache();
    return {} as T;
  }

  const data = await response.json();

  if (isGet) {
    storage.setCached(cacheKey, data, CACHE_DURATION);
  } else {
    clearJulesCache();
    // Also clear GitHub cache if we likely caused a PR update
    storage.clearCaches(); 
  }

  return data;
};

export const listSources = async (apiKey: string, filter?: string): Promise<JulesSource[]> => {
  const query = filter ? `?filter=${encodeURIComponent(filter)}` : '';
  const data = await request<{ sources: JulesSource[] }>(`sources${query}`, apiKey);
  return data.sources || [];
};

export const listSessions = async (apiKey: string): Promise<JulesSession[]> => {
  let allSessions: JulesSession[] = [];
  let nextToken: string | undefined = undefined;
  let pages = 0;
  
  do {
    const query = nextToken ? `?pageToken=${nextToken}` : '';
    const data = await request<{ sessions: JulesSession[], nextPageToken?: string }>(`sessions${query}`, apiKey);
    if (data.sessions) allSessions = [...allSessions, ...data.sessions];
    nextToken = data.nextPageToken;
    pages++;
  } while (nextToken && pages < 5);

  return allSessions;
};

export const createSession = async (
  apiKey: string, 
  prompt: string, 
  sourceId: string, 
  branch: string = 'leader', 
  title?: string
): Promise<JulesSession> => {
  const payload: any = {
    prompt,
    sourceContext: {
      source: sourceId,
      githubRepoContext: { startingBranch: branch }
    }
  };
  if (title) payload.title = title;
  return request<JulesSession>('sessions', apiKey, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
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
  return request<void>(endpoint, apiKey, { method: 'DELETE' });
};

export const findSourceForRepo = async (apiKey: string, repoName: string): Promise<string | null> => {
  try {
    const sources = await listSources(apiKey);
    
    // Normalize target repo name (e.g. "owner/my-repo" -> "my-repo")
    const repoParts = repoName.split('/');
    const repoOnly = repoParts[repoParts.length - 1].toLowerCase();
    const fullNormalized = repoName.toLowerCase();
    
    // Helper to normalize strings for comparison (lowercase, remove non-alphanumeric)
    const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedRepoOnly = normalizeForMatch(repoOnly);
    const normalizedFullRepo = normalizeForMatch(repoName);
    
    // 1. Try exact matches on normalized strings
    let match = sources.find(s => {
      const sourceName = s.name.toLowerCase();
      const sourceDisplayName = (s.displayName || '').toLowerCase();
      
      // Exact match on source name (usually "sources/my-repo")
      if (sourceName === fullNormalized || sourceName.endsWith(`/${repoOnly}`)) return true;
      if (sourceName.endsWith(`/${normalizedRepoOnly}`)) return true;
      
      // Exact match on display name
      if (sourceDisplayName === repoOnly || sourceDisplayName === repoName) return true;
      
      return false;
    });

    // 2. Try fuzzy matches (ignoring - and _)
    if (!match) {
      match = sources.find(s => {
        const nName = normalizeForMatch(s.name);
        const nDisplayName = normalizeForMatch(s.displayName || '');
        
        return nName.endsWith(normalizedRepoOnly) || 
               nName === normalizedFullRepo ||
               nDisplayName === normalizedRepoOnly ||
               nDisplayName === normalizedFullRepo;
      });
    }

    if (!match) {
      console.warn(`[JulesService] No source matched repoName: "${repoName}". Available sources:`, sources.map(s => ({ name: s.name, display: s.displayName })));
    } else {
      console.log(`[JulesService] Auto-detected source mapping: "${repoName}" -> "${match.name}"`);
    }

    return match ? match.name : null;
  } catch (e) {
    console.error(`[JulesService] Error listing sources for repoName "${repoName}":`, e);
    return null;
  }
};
