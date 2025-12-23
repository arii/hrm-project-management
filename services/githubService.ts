
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
const request = async <T>(endpoint: string, token: string | undefined, options: RequestInit = {}, isText = false): Promise<T> => {
  const isGet = !options.method || options.method === 'GET';
  
  // Handle X-Skip-Cache safely
  const customHeaders = options.headers as Record<string, string> | undefined;
  const skipCache = customHeaders?.['X-Skip-Cache'] === 'true';
  
  const cacheKey = `${CACHE_PREFIX}${endpoint}`;

  // 1. Try to read from cache (ONLY for JSON responses for now, text responses not cached yet)
  if (isGet && !skipCache && !isText) {
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
    'Accept': isText ? 'application/vnd.github.v3.diff' : 'application/vnd.github.v3+json',
    // Do not set Content-Type for GET
    ...options.headers,
  };

  if (!isText && !headers['Content-Type']) {
     // @ts-ignore
     headers['Content-Type'] = 'application/json';
  }
  
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

  let response: Response | undefined;
  let retries = 3;
  while (retries > 0) {
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        ...fetchOptions,
        headers: { ...headers, ...fetchOptions.headers },
      });

      // Handle 429 Too Many Requests
      if (response.status === 429) {
        throw new Error("Rate limit exceeded");
      }
      
      // Handle 403 Rate Limit (Secondary or Primary)
      if (response.status === 403) {
         const remaining = response.headers.get('x-ratelimit-remaining');
         if (remaining === '0') {
             throw new Error("GitHub API Rate Limit Exceeded. Please add a Personal Access Token in Settings to increase your limit (5000 req/hr).");
         }
      }
      
      break;
    } catch (e: any) {
      console.warn(`[GitHub] Fetch failed for ${endpoint} (retries left: ${retries - 1}):`, e.message);
      
      // If it's our specific rate limit error, don't retry, just fail fast
      if (e.message.includes('Rate Limit Exceeded')) throw e;

      retries--;
      if (retries === 0) throw new Error(`Network error: Failed to reach GitHub. ${e.message}`);
      
      // Check if it's a network/fetch error and wait longer
      const isNetworkError = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'));
      const baseDelay = isNetworkError ? 2000 : 1000;

      // Exponential Backoff: 1s, 2s, 4s (or 2s, 4s, 8s for network errors)
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, 3 - retries))); 
    }
  }

  if (!response) throw new Error("Unknown network error");

  if (!response.ok) {
    let errorMessage = `GitHub API Error: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.message) {
         errorMessage = errorBody.message;
         // Catch the specific IP rate limit message if we missed it above
         if (errorMessage.includes("API rate limit exceeded")) {
             errorMessage = "GitHub API Rate Limit Exceeded. Please add a Personal Access Token in Settings.";
         }
      }
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

  if (isText) {
     return response.text() as unknown as T;
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

export const fetchIssueDetails = async (repo: string, number: number, token?: string): Promise<GithubIssue> => {
  return request<GithubIssue>(`/repos/${repo}/issues/${number}`, token);
};

export const fetchPullRequests = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubPullRequest[]> => {
  return request<GithubPullRequest[]>(`/repos/${repo}/pulls?state=${state}&per_page=100`, token);
};

export const fetchPrDetails = async (repo: string, number: number, token?: string, skipCache = false): Promise<GithubPullRequest> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  return request<GithubPullRequest>(`/repos/${repo}/pulls/${number}`, token, options);
};

export const fetchPrDiff = async (repo: string, number: number, token: string): Promise<string> => {
  // Use request helper with isText=true for robust error handling
  return request<string>(`/repos/${repo}/pulls/${number}`, token, {}, true);
};

export const fetchComments = async (repo: string, issueNumber: number, token?: string) => {
  try {
    return await request<any[]>(`/repos/${repo}/issues/${issueNumber}/comments`, token);
  } catch (e) {
    return [];
  }
};

export const fetchReviewComments = async (repo: string, number: number, token?: string) => {
  return request<any[]>(`/repos/${repo}/pulls/${number}/comments`, token);
};

export const fetchBranches = async (repo: string, token: string): Promise<GithubBranch[]> => {
  let allBranches: GithubBranch[] = [];
  let page = 1;
  const PER_PAGE = 100;

  // Pagination loop to fetch all branches
  while (true) {
    try {
      const batch = await request<GithubBranch[]>(`/repos/${repo}/branches?per_page=${PER_PAGE}&page=${page}`, token);
      if (!batch || batch.length === 0) break;
      allBranches = [...allBranches, ...batch];
      
      if (batch.length < PER_PAGE) break; // Reached last page
      
      page++;
      // Safety break to prevent infinite loops on massive repos
      if (page > 30) {
        console.warn('Branch fetch limit reached (3000 branches). Stopping pagination.');
        break;
      }
    } catch (e) {
      console.error('Failed to fetch branch page', page, e);
      break;
    }
  }
  return allBranches;
};

export const deleteBranch = async (repo: string, token: string, branchName: string) => {
  const refPath = branchName.split('/').map(encodeURIComponent).join('/');
  return request(`/repos/${repo}/git/refs/heads/${refPath}`, token, { method: 'DELETE' });
};

export const createIssue = async (repo: string, token: string, issue: { title: string; body: string; labels?: string[] }) => {
  return request(`/repos/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify(issue),
  });
};

export const updateIssue = async (repo: string, token: string, number: number, updates: { state?: 'open' | 'closed'; labels?: string[]; title?: string; body?: string }) => {
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

export const removeLabel = async (repo: string, token: string, number: number, label: string) => {
  return request(`/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, token, {
    method: 'DELETE',
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

export const publishPullRequest = async (repo: string, token: string, number: number, nodeId?: string) => {
  if (!nodeId) {
     const pr = await fetchPrDetails(repo, number, token);
     nodeId = pr.node_id; 
  }
  
  const query = `
    mutation {
      markPullRequestReadyForReview(input: {pullRequestId: "${nodeId}"}) {
        pullRequest { isDraft }
      }
    }
  `;
  
  // Use /graphql endpoint
  return request('/graphql', token, {
     method: 'POST',
     body: JSON.stringify({ query })
  });
};

export const fetchEnrichedPullRequests = async (repo: string, token?: string): Promise<EnrichedPullRequest[]> => {
  const list = await fetchPullRequests(repo, token, 'open');
  const subset = list.slice(0, 20); 
  
  const results: EnrichedPullRequest[] = [];
  const BATCH_SIZE = 3; 

  for (let i = 0; i < subset.length; i += BATCH_SIZE) {
    const batch = subset.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(batch.map(async (pr) => {
      try {
        let details = await fetchPrDetails(repo, pr.number, token);

        let retries = 0;
        while (details.mergeable === null && retries < 3) {
           await new Promise(r => setTimeout(r, 1500));
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
        const safeBaseRef = details?.base?.ref || '';
        const isLeaderBranch = ['main', 'master', 'develop', 'dev', 'staging', 'release', 'leader'].includes(safeBaseRef.toLowerCase());
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
    
    results.push(...batchResults);

    if (i + BATCH_SIZE < subset.length) {
       await new Promise(r => setTimeout(r, 1000));
    }
  }

  return results;
};

// Batch fetch for background prefetching
export const prefetchRepositoryData = async (repo: string, token: string) => {
  const [issues, prs, closedPrs] = await Promise.all([
    fetchIssues(repo, token, 'open'),
    fetchPullRequests(repo, token, 'open'),
    fetchPullRequests(repo, token, 'closed'),
  ]);
  return { issues, prs, closedPrs };
};

// Fetch raw file content (or directory listing)
export const fetchRepoContent = async (repo: string, path: string, token: string): Promise<any> => {
  try {
    const data = await request<any>(`/repos/${repo}/contents/${path}`, token);
    
    // If it's a file with content (base64)
    if (!Array.isArray(data) && data.content && data.encoding === 'base64') {
      try {
        return atob(data.content.replace(/\n/g, ''));
      } catch (e) {
        console.warn('Failed to decode base64 content', e);
        return null;
      }
    }
    
    // If it's a directory (array) or a file without content (too large?), return raw
    return data;
  } catch (e) {
    // 404 is common if path doesn't exist
    return null;
  }
};
