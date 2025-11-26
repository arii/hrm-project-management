
import { JulesSession, JulesSource } from '../types';

const JULES_API_BASE = 'https://jules.googleapis.com/v1alpha';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = 'jules_cache_';

const clearCache = () => {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    console.log('[Jules Cache] Cleared all cache entries due to mutation.');
  } catch (e) {
    console.warn('Failed to clear Jules cache', e);
  }
};

// Internal helper for Jules API requests
const request = async <T>(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<T> => {
  if (!apiKey) {
    throw new Error("Jules API Key is missing. Please configure it in Settings.");
  }

  const isGet = !options.method || options.method === 'GET';
  const cacheKey = `${CACHE_PREFIX}${endpoint}`;

  // 1. Try to read from cache
  if (isGet) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          // console.debug(`[Jules Cache] Hit: ${endpoint}`);
          return data as T;
        }
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }
  }

  const trimmedKey = apiKey.trim();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': trimmedKey,
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${JULES_API_BASE}/${endpoint}`, {
      ...options,
      headers,
    });
  } catch (e: any) {
    console.error(`[Jules] Fetch failed for ${endpoint}:`, e);
    throw new Error("Network error: Failed to reach Jules API. Check your connection or CORS settings.");
  }

  if (!response.ok) {
    let errorMessage = `Jules API Error: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error && errorBody.error.message) {
        errorMessage = errorBody.error.message;
      }
    } catch (e) {
      // ignore
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    if (!isGet) clearCache();
    return {} as T;
  }

  const data = await response.json();

  // If we performed a mutation (POST, PATCH, DELETE), clear cache to ensure freshness
  if (!isGet) {
    clearCache();
  } else {
    // 2. Save to cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data
      }));
    } catch (e) {
      console.warn('Failed to cache Jules request (likely quota exceeded)', e);
    }
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

  // Simple loop to fetch all pages (limit to 5 pages to prevent infinite loops in bad states)
  let pages = 0;
  do {
    const query = nextToken ? `?pageToken=${nextToken}` : '';
    const data = await request<{ sessions: JulesSession[], nextPageToken?: string }>(`sessions${query}`, apiKey);
    if (data.sessions) {
      allSessions = [...allSessions, ...data.sessions];
    }
    nextToken = data.nextPageToken;
    pages++;
  } while (nextToken && pages < 5);

  return allSessions;
};

export const getSession = async (apiKey: string, sessionName: string): Promise<JulesSession> => {
  return request<JulesSession>(`sessions/${sessionName}`, apiKey);
};

export const createSession = async (
  apiKey: string, 
  prompt: string, 
  sourceId: string, 
  branch: string = 'main', 
  title?: string
): Promise<JulesSession> => {
  
  const payload: any = {
    prompt,
    sourceContext: {
      source: sourceId,
      githubRepoContext: {
        startingBranch: branch
      }
    }
  };

  if (title) {
    payload.title = title;
  }

  return request<JulesSession>('sessions', apiKey, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const sendMessage = async (apiKey: string, sessionName: string, text: string): Promise<any> => {
  // Extract simple ID if full name provided for URL construction if needed, 
  // but API usually expects resource name in path
  return request(`sessions/${sessionName}:sendMessage`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ prompt: text })
  });
};

export const deleteSession = async (apiKey: string, sessionName: string): Promise<void> => {
  return request<void>(`sessions/${sessionName}`, apiKey, {
    method: 'DELETE'
  });
};

// Helper to find the correct source ID for a given repo
export const findSourceForRepo = async (apiKey: string, repoName: string): Promise<string | null> => {
  // Heuristic: try to find a source that ends with the repo name
  try {
    const sources = await listSources(apiKey);
    // e.g. sources/github/arii/hrm
    const match = sources.find(s => s.name.endsWith(repoName) || s.name.includes(repoName));
    return match ? match.name : null;
  } catch (e) {
    console.error("Failed to fetch sources", e);
    return null;
  }
};
