
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
    const match = sources.find(s => s.name.endsWith(repoName) || s.name.includes(repoName));
    return match ? match.name : null;
  } catch (e) {
    return null;
  }
};
