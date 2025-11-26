
import { GithubIssue, GithubPullRequest, RepoStats, EnrichedPullRequest, GithubBranch } from '../types';

const BASE_URL = 'https://api.github.com';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = 'gh_cache_';

const clearCache = () => {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    console.log('[Cache] Cleared all GitHub cache entries due to mutation.');
  } catch (e) {
    console.warn('Failed to clear cache', e);
  }
};

// --- Internal Helper for Requests ---
const request = async <T>(endpoint: string, token: string | undefined, options: RequestInit = {}): Promise<T> => {
  const isGet = !options.method || options.method === 'GET';
  
  // Handle X-Skip-Cache safely
  const customHeaders = options.headers as Record<string, string> | undefined;
  const skipCache = customHeaders?.['X-Skip-Cache'] === 'true';
  
  const cacheKey = `${CACHE_PREFIX}${endpoint}`;

  // 1. Try to read from cache
  if (isGet && !skipCache) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          // console.debug(`[Cache] Hit: ${endpoint}`);
          return data as T;
        }
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }
  }

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  
  // Trim token to prevent "Invalid Header Value" errors from copy-paste whitespace
  if (token && token.trim()) {
    headers['Authorization'] = `token ${token.trim()}`;
  }

  // Prepare options for fetch, removing our internal X-Skip-Cache header
  const fetchOptions = { ...options };
  if (fetchOptions.headers) {
     const h = { ...(fetchOptions.headers as any) };
     if (h['X-Skip-Cache']) delete h['X-Skip-Cache'];
     fetchOptions.headers = h;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers: { ...headers, ...fetchOptions.headers },
    });
  } catch (e: any) {
    console.error(`[GitHub] Fetch failed for ${endpoint}:`, e);
    throw new Error(`Network error: Failed to reach GitHub. Check your connection or API token.`);
  }

  if (!response.ok) {
    let errorMessage = `GitHub API Error: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.message) errorMessage = errorBody.message;
    } catch (e) {
      // Ignore json parse error
    }
    throw new Error(errorMessage);
  }

  // If we performed a mutation (POST, PATCH, DELETE), clear cache to ensure freshness
  if (!isGet) {
    clearCache();
    // Handle 204 No Content (often returned by DELETE or some updates)
    if (response.status === 204) {
      return {} as T;
    }
    return response.json();
  }

  const data = await response.json();

  // 2. Save to cache (even if we skipped reading, we update the cache with fresh data)
  if (isGet) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data
      }));
    } catch (e) {
      // Handle quota exceeded
      console.warn('Failed to cache request (likely quota exceeded)', e);
    }
  }

  return data;
};

// --- API Methods ---

export const fetchRepoStats = async (repo: string, token?: string): Promise<RepoStats> => {
  const data = await request<any>(`/repos/${repo}`, token);
  return {
    openIssuesCount: data.open_issues_count,
    openPRsCount: 0, // Calculated separately
    lastUpdated: data.updated_at,
    stars: data.stargazers_count,
    forks: data.forks_count,
  };
};

export const fetchIssues = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubIssue[]> => {
  const data = await request<GithubIssue[]>(`/repos/${repo}/issues?state=${state}&per_page=100`, token);
  return data.filter(item => !item.pull_request);
};

export const fetchPullRequests = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubPullRequest[]> => {
  return request<GithubPullRequest[]>(`/repos/${repo}/pulls?state=${state}&per_page=100`, token);
};

export const fetchPrDetails = async (repo: string, number: number, token?: string, skipCache = false): Promise<GithubPullRequest> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  return request<GithubPullRequest>(`/repos/${repo}/pulls/${number}`, token, options);
};

export const fetchComments = async (repo: string, issueNumber: number, token?: string) => {
  try {
    return await request<any[]>(`/repos/${repo}/issues/${issueNumber}/comments`, token);
  } catch (e) {
    return [];
  }
};

export const fetchBranches = async (repo: string, token: string): Promise<GithubBranch[]> => {
  return request<GithubBranch[]>(`/repos/${repo}/branches?per_page=100`, token);
};

export const deleteBranch = async (repo: string, token: string, branchName: string) => {
  // GitHub API deletes a branch by deleting the Ref
  return request(`/repos/${repo}/git/refs/heads/${branchName}`, token, { method: 'DELETE' });
};

export const createIssue = async (repo: string, token: string, issue: { title: string; body: string; labels?: string[] }) => {
  return request(`/repos/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify(issue),
  });
};

export const updateIssue = async (repo: string, token: string, number: number, updates: { state?: 'open' | 'closed'; labels?: string[] }) => {
  return request(`/repos/${repo}/issues/${number}`, token, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
};

export const addLabels = async (repo: string, token: string, number: number, labels: string[]) => {
  return request(`/repos/${repo}/issues/${number}/labels`, token, {
    method: 'POST',
    body: JSON.stringify({ labels }),
  });
};

export const addComment = async (repo: string, token: string, number: number, body: string) => {
  return request(`/repos/${repo}/issues/${number}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
};

export const fetchRecentActivity = async (repo: string, token?: string, days = 30): Promise<GithubIssue[]> => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const since = date.toISOString();
  const data = await request<GithubIssue[]>(`/repos/${repo}/issues?state=all&since=${since}&per_page=100`, token);
  return data.filter(item => !item.pull_request);
};

// Complex Aggregation Logic
export const fetchEnrichedPullRequests = async (repo: string, token?: string): Promise<EnrichedPullRequest[]> => {
  const list = await fetchPullRequests(repo, token, 'open');
  const subset = list.slice(0, 20); // Limit to avoid rate limits

  return Promise.all(subset.map(async (pr) => {
    try {
      let details = await fetchPrDetails(repo, pr.number, token);

      // Retry logic for mergeability
      let retries = 0;
      while (details.mergeable === null && retries < 3) {
         await new Promise(r => setTimeout(r, 1500));
         // Force skip cache on retry to get fresh mergeable status
         details = await fetchPrDetails(repo, pr.number, token, true);
         retries++;
      }

      const comments = await fetchComments(repo, pr.number, token);
      
      const sortedComments = Array.isArray(comments) 
        ? comments.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) 
        : [];
      
      let testStatus: 'passed' | 'failed' | 'pending' | 'unknown' = 'unknown';
      
      for (const c of sortedComments) {
        const body = (c.body || '').toLowerCase();
        if (body.includes('test failed') || body.includes('tests failed') || body.includes('build failed') || body.includes('checks failed') || body.includes('failure')) {
           testStatus = 'failed';
           break;
        }
        if (body.includes('test passed') || body.includes('tests passed') || body.includes('all checks passed') || body.includes('build success') || body.includes('successful')) {
           testStatus = 'passed';
           break;
        }
      }

      const filesChanged = details.changed_files || 0;
      const isBig = filesChanged > 15 || (details.additions || 0) > 500;
      const isLeaderBranch = ['main', 'master', 'develop', 'dev', 'staging', 'release'].includes(details.base.ref.toLowerCase());
      const noConflicts = details.mergeable === true;
      
      let isReadyToMerge = false;
      
      if (noConflicts) {
        if (testStatus === 'failed') {
          isReadyToMerge = false;
        } else if (!isLeaderBranch) {
          isReadyToMerge = true;
        } else {
          isReadyToMerge = testStatus === 'passed';
        }
      }

      return {
        ...details,
        testStatus,
        isBig,
        isReadyToMerge,
        isLeaderBranch
      } as EnrichedPullRequest;

    } catch (e) {
      console.warn(`Failed to enrich PR #${pr.number}`, e);
      return {
         ...pr,
         testStatus: 'unknown',
         isBig: false,
         isReadyToMerge: false,
         isLeaderBranch: false
      } as EnrichedPullRequest;
    }
  }));
};
