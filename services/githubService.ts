
import { GithubIssue, GithubPullRequest, RepoStats, EnrichedPullRequest, GithubWorkflowRun, GithubWorkflowJob, GithubAnnotation } from '../types';
import { storage, StorageKeys } from './storageService';

const BASE_URL = 'https://api.github.com';
const CACHE_DURATION = 15 * 60 * 1000;

const request = async <T>(endpoint: string, token: string | undefined, options: RequestInit = {}, isText = false): Promise<T> => {
  const isGet = !options.method || options.method === 'GET';
  
  // Basic URL validation
  if (!endpoint.startsWith('/')) {
    throw new Error(`Invalid endpoint: ${endpoint}. Endpoints must start with /`);
  }

  const customHeaders = options.headers as Record<string, string> | undefined;
  const skipCache = customHeaders?.['X-Skip-Cache'] === 'true';
  const cacheKey = `${StorageKeys.GITHUB_CACHE}_${endpoint}`;

  if (isGet && !skipCache && !isText) {
    const cached = storage.getRaw<{ timestamp: number; data: any } | null>(cacheKey, null);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data as T;
    }
  }

  const headers: Record<string, string> = {
    'Accept': isText ? 'application/vnd.github.v3.diff' : 'application/vnd.github.v3+json',
  };

  // Add token if provided
  if (token && token.trim()) {
    const trimmedToken = token.trim();
    // Basic validation for GitHub token format
    if (!/^(ghp_|github_pat_|[a-zA-Z0-9_]+$)/.test(trimmedToken)) {
      console.warn("[GithubService] Token format looks unusual, but proceeding.");
    }
    headers['Authorization'] = `token ${trimmedToken}`;
  }

  // Add options headers, but filter out internal ones
  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (key.toLowerCase() !== 'x-skip-cache') {
        headers[key] = value as string;
      }
    });
  }

  if (!isGet && !isText && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = { 
    ...options,
    headers,
    mode: 'cors'
  };

  let response: Response | undefined;
  let retries = 2;
  const fullUrl = `${BASE_URL}${endpoint}`;
  const timeout = 15000; // 15 seconds timeout

  while (retries >= 0) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      response = await fetch(fullUrl, {
        ...fetchOptions,
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
          throw new Error("GitHub API Rate Limit Exceeded.");
      }
      break;
    } catch (e: any) {
      clearTimeout(id);
      if (retries === 0) {
        console.error(`[GithubService] Fetch failed for ${fullUrl}:`, e);
        if (e.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeout/1000}s. GitHub might be slow or the request is too large. (Target: ${fullUrl})`);
        }
        if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
          throw new Error(`Network error: Failed to reach GitHub API. This often happens due to CORS issues, network blocks, or invalid headers. (Target: ${fullUrl})`);
        }
        throw e;
      }
      // Retry up to 2 times with 1s/2s backoff for transient network errors
      retries--;
      await new Promise(r => setTimeout(r, 1000 * (2 - retries))); 
    }
  }

  if (!response) throw new Error("Unknown network error: No response received from GitHub.");

  if (!response.ok) {
    let errorMessage = `Error: ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.message) {
        errorMessage = errorBody.message;
        
        // Enrich common error messages with helpful solutions
        if (errorMessage.includes('Resource not accessible by personal access token')) {
          errorMessage = "GitHub Permissions Error: Your Personal Access Token doesn't have enough permissions to perform this action. If using a Fine-grained token, ensure 'Issues' and 'Pull Requests' have Read & Write access. If using a Classic token, ensure 'repo' scope is selected.";
        } else if (response.status === 403 && errorMessage.includes('rate limit exceeded')) {
          errorMessage = "GitHub API Rate Limit Exceeded. Please wait a few minutes before trying again.";
        } else if (response.status === 404) {
          errorMessage = `Resource not found (404). Check if the repository name "${endpoint.split('/')[2]}/${endpoint.split('/')[3]}" is correct and your token has access to it.`;
        }
      }
    } catch (e) {}
    throw new Error(errorMessage);
  }

  if (!isGet) {
    // Clear relevant caches on mutation
    storage.clearCaches();
    if (response.status === 204) return {} as T;
    return response.json();
  }

  if (isText) return response.text() as unknown as T;

  const data = await response.json();
  if (isGet) {
    storage.set(cacheKey, { timestamp: Date.now(), data });
  }
  return data;
};

export const fetchPullRequests = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open', skipCache = false): Promise<GithubPullRequest[]> => {
  const cacheKey = `${StorageKeys.GITHUB_CACHE}_pulls_${repo}_${state}`;
  if (!skipCache) {
    const cached = storage.get<GithubPullRequest[]>(cacheKey);
    if (cached) return cached;
  }

  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  const prs = await request<GithubPullRequest[]>(`/repos/${repo}/pulls?state=${state}&per_page=100`, token, options);
  
  if (prs && !skipCache) {
    storage.setCached(cacheKey, prs);
  }
  return prs;
};

export const fetchPrDetails = async (repo: string, number: number, token?: string, skipCache = false): Promise<GithubPullRequest> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  return request<GithubPullRequest>(`/repos/${repo}/pulls/${number}`, token, options);
};

export const fetchPrReviews = async (repo: string, number: number, token?: string) => {
  return request<any[]>(`/repos/${repo}/pulls/${number}/reviews`, token);
};

export const fetchPrDiff = async (repo: string, number: number, token: string, sha?: string): Promise<string> => {
  const cacheKey = `${StorageKeys.GITHUB_CACHE}_diff_${repo}_${number}`;
  
  if (sha) {
    const cached = storage.getCachedBySha<string>(cacheKey, sha);
    if (cached) return cached;
  }

  const diff = await request<string>(`/repos/${repo}/pulls/${number}`, token, {
    headers: { 'Accept': 'application/vnd.github.v3.diff' }
  }, true);

  if (diff && sha) {
    storage.setCached(cacheKey, { head: { sha }, data: diff });
  }

  return diff;
};

export const fetchCheckRuns = async (repo: string, ref: string, token: string, skipCache = false) => {
  try {
    const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
    const data = await request<any>(`/repos/${repo}/commits/${ref}/check-runs`, token, options);
    return data.check_runs.map((run: any) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url
    }));
  } catch (e) {
    return [];
  }
};

export const fetchCombinedStatus = async (repo: string, ref: string, token: string, skipCache = false) => {
  try {
    const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
    const data = await request<any>(`/repos/${repo}/commits/${ref}/status`, token, options);
    return {
      state: data.state, // 'failure', 'pending', 'success', 'error'
      statuses: data.statuses.map((s: any) => ({
        name: s.context,
        status: s.state,
        conclusion: s.state === 'success' ? 'success' : (s.state === 'pending' ? null : 'failure'),
        url: s.target_url
      }))
    };
  } catch (e) {
    return { state: 'unknown', statuses: [] };
  }
};

export const fetchWorkflowRuns = async (repo: string, token: string, skipCache = false, page = 1, status?: string): Promise<GithubWorkflowRun[]> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  const statusParam = status ? `&status=${status}` : '';
  const data = await request<{ workflow_runs: GithubWorkflowRun[] }>(`/repos/${repo}/actions/runs?per_page=100&page=${page}${statusParam}`, token, options);
  return data.workflow_runs || [];
};

export const fetchWorkflowRun = async (repo: string, runId: number, token: string): Promise<GithubWorkflowRun> => {
  return request<GithubWorkflowRun>(`/repos/${repo}/actions/runs/${runId}`, token);
};

export const fetchWorkflowRunJobs = async (repo: string, runId: number, token: string): Promise<GithubWorkflowJob[]> => {
  const data = await request<{ jobs: GithubWorkflowJob[] }>(`/repos/${repo}/actions/runs/${runId}/jobs`, token);
  return data.jobs || [];
};

export const fetchJobAnnotations = async (repo: string, jobId: number, token: string): Promise<GithubAnnotation[]> => {
  try {
    return request<GithubAnnotation[]>(`/repos/${repo}/check-runs/${jobId}/annotations`, token);
  } catch (e) {
    return [];
  }
};

export const fetchWorkflowsContent = async (repo: string, token: string): Promise<Array<{ name: string, path: string, content: string }>> => {
  try {
    const workflowsDir = await request<any[]>(`/repos/${repo}/contents/.github/workflows`, token);
    const results = [];
    for (const file of workflowsDir) {
      if (file.type === 'file' && (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))) {
        const content = await fetchRepoContent(repo, file.path, token);
        if (content) results.push({ name: file.name, path: file.path, content });
      }
    }
    return results;
  } catch (e) {
    return [];
  }
};

export const createIssue = async (repo: string, token: string, issue: { title: string; body: string; labels?: string[] }) => {
  return request(`/repos/${repo}/issues`, token, { method: 'POST', body: JSON.stringify(issue) });
};

export const updateIssue = async (repo: string, token: string, number: number, updates: { state?: 'open' | 'closed'; labels?: string[]; title?: string; body?: string }) => {
  return request(`/repos/${repo}/issues/${number}`, token, { method: 'PATCH', body: JSON.stringify(updates) });
};

export const addLabels = async (repo: string, token: string, number: number, labels: string[]) => {
  return request(`/repos/${repo}/issues/${number}/labels`, token, { method: 'POST', body: JSON.stringify({ labels }) });
};

export const removeLabel = async (repo: string, token: string, number: number, label: string) => {
  return request(`/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, token, { method: 'DELETE' });
};

export const addComment = async (repo: string, token: string, number: number, body: string) => {
  return request(`/repos/${repo}/issues/${number}/comments`, token, { method: 'POST', body: JSON.stringify({ body }) });
};

/**
 * Resolves and fetches the workflow YAML that GitHub actually executed for
 * a given run by reading the file at the run's triggering commit SHA.
 */
export const fetchWorkflowFileAtSha = async (
  repo: string,
  run: GithubWorkflowRun,
  token: string
): Promise<{ path: string; ref: string; content: string } | null> => {
  try {
    const workflowMeta = await request<{ path: string; name: string }>(
      `/repos/${repo}/actions/workflows/${run.workflow_id}`,
      token
    );

    const filePath = workflowMeta.path;
    let ref = run.head_sha;

    if (run.event === 'pull_request_target') {
      ref = run.head_branch;
    }

    const fileData = await request<{ content: string; encoding: string; sha: string }>(
      `/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`,
      token
    );

    if (fileData.encoding === 'base64' && fileData.content) {
      try {
        const decoded = atob(fileData.content.replace(/\n/g, ''));
        return {
          path: filePath,
          ref,
          content: decoded.substring(0, 8000)
        };
      } catch (decodeError) {
        console.error(`[githubService] Failed to decode base64 content for ${filePath}:`, decodeError);
        return null;
      }
    }
    return null;
  } catch (e) {
    console.warn(`[githubService] fetchWorkflowFileAtSha failed for run ${run.id}:`, e);
    return null;
  }
};

export const updatePullRequestBranch = async (repo: string, number: number, token: string) => {
  return request(`/repos/${repo}/pulls/${number}/update-branch`, token, { method: 'PUT' });
};

export const fetchComments = async (repo: string, number: number, token: string): Promise<any[]> => {
  return request<any[]>(`/repos/${repo}/issues/${number}/comments`, token);
};

export const fetchReviewComments = async (repo: string, number: number, token: string): Promise<any[]> => {
  return request<any[]>(`/repos/${repo}/pulls/${number}/comments`, token);
};

export const publishPullRequest = async (repo: string, token: string, number: number, nodeId?: string) => {
  if (!nodeId) {
     const pr = await fetchPrDetails(repo, number, token);
     nodeId = pr.node_id; 
  }
  const query = `mutation { markPullRequestReadyForReview(input: {pullRequestId: "${nodeId}"}) { pullRequest { isDraft } } }`;
  return request('/graphql', token, { method: 'POST', body: JSON.stringify({ query }) });
};

/**
 * GRAPHQL-BASED PR ENRICHMENT (High Speed)
 * Replaces 4 REST calls with 1 GraphQL call.
 */
const enrichSinglePrGraphQL = async (repo: string, pr: GithubPullRequest, token: string, includeReviews = false): Promise<EnrichedPullRequest> => {
  const [owner, name] = repo.split('/');
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          number
          title
          body
          state
          mergeable
          mergeStateStatus
          changedFiles
          additions
          deletions
          headRefName
          baseRefName
          headRefOid
          author { login }
          ${includeReviews ? `
          reviews(last: 50) {
            nodes {
              state
              author { login }
            }
          }
          ` : ''}
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(last: 100) {
                    nodes {
                      ... on CheckRun {
                        name
                        status
                        conclusion
                        detailsUrl
                      }
                      ... on StatusContext {
                        context
                        state
                        targetUrl
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await request<any>('/graphql', token, {
    method: 'POST',
    body: JSON.stringify({ query, variables: { owner, name, number: pr.number } })
  });

  if (response.errors) {
    throw new Error(response.errors[0].message);
  }

  const data = response.data.repository.pullRequest;
  if (!data) throw new Error("PR not found in GraphQL response");

  // Map GraphQL nodes to our expected format
  const reviews = (data.reviews?.nodes || []).map((r: any) => ({
    state: r.state,
    user: { login: r.author?.login || 'unknown' }
  }));

  const checkNodes = data.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
  const allChecks = checkNodes.map((n: any) => ({
    name: n.name || n.context,
    status: n.status || (n.state === 'PENDING' ? 'in_progress' : 'completed'),
    conclusion: n.conclusion?.toLowerCase() || (n.state === 'SUCCESS' ? 'success' : (n.state === 'PENDING' ? null : 'failure')),
    url: n.detailsUrl || n.targetUrl
  }));

  const failedCount = allChecks.filter((r: any) => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'action_required').length;
  const pendingCount = allChecks.filter((r: any) => r.status !== 'completed' && r.status !== 'success' && r.status !== 'skipped' && r.status !== 'cancelled').length;
  
  let testStatus: 'passed' | 'failed' | 'pending' | 'unknown' = 'unknown';
  if (failedCount > 0) testStatus = 'failed';
  else if (pendingCount > 0) testStatus = 'pending';
  else if (allChecks.length > 0) {
    const allPassed = allChecks.every((r: any) => r.conclusion === 'success' || r.conclusion === 'skipped' || r.conclusion === 'neutral');
    testStatus = allPassed ? 'passed' : 'failed';
  } else {
    const rollupState = data.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    if (rollupState === 'SUCCESS') testStatus = 'passed';
    else if (rollupState === 'FAILURE' || rollupState === 'ERROR') testStatus = 'failed';
    else if (rollupState === 'PENDING') testStatus = 'pending';
  }

  const latestReviewsByUser: Record<string, string> = {};
  reviews.forEach((r: any) => { latestReviewsByUser[r.user.login] = r.state; });
  const reviewStates = Object.values(latestReviewsByUser);
  const isApproved = reviewStates.includes('APPROVED') && !reviewStates.includes('CHANGES_REQUESTED');

  return {
    ...pr,
    mergeable: data.mergeable === 'MERGEABLE',
    mergeable_state: data.mergeStateStatus?.toLowerCase(),
    changed_files: data.changedFiles,
    additions: data.additions,
    deletions: data.deletions,
    testStatus,
    checkResults: allChecks,
    isApproved,
    isBig: data.changedFiles > 15,
    isReadyToMerge: data.mergeable === 'MERGEABLE',
    isLeaderBranch: ['leader', 'main', 'master', 'develop'].includes(data.baseRefName.toLowerCase())
  } as EnrichedPullRequest;
};

function deriveTestStatus(
  allChecks: any[], 
  combinedState: string
): 'passed' | 'failed' | 'pending' | 'unknown' {
  const failedCount = allChecks.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'action_required').length;
  const pendingCount = allChecks.filter(r => r.status !== 'completed' && r.status !== 'success' && r.status !== 'skipped' && r.status !== 'cancelled').length;
  
  if (failedCount > 0) return 'failed';
  if (pendingCount > 0) return 'pending';
  if (allChecks.length > 0) {
    const allPassed = allChecks.every(r => r.conclusion === 'success' || r.conclusion === 'skipped' || r.conclusion === 'neutral');
    return allPassed ? 'passed' : 'failed';
  }
  if (combinedState === 'success') return 'passed';
  if (combinedState === 'failure' || combinedState === 'error') return 'failed';
  if (combinedState === 'pending') return 'pending';
  return 'unknown';
}

/**
 * HIGH-FIDELITY SINGLE PR ENRICHMENT
 * Fetches both Checks and Statuses to determine test health.
 */
export const enrichSinglePr = async (repo: string, pr: GithubPullRequest, token?: string, includeReviews = false): Promise<EnrichedPullRequest> => {
  if (!repo || !repo.includes('/')) {
    throw new Error(`Invalid repository name: "${repo}". Must be in "owner/repo" format.`);
  }
  
  // Tier 2: Cache key differentiates between lite and full
  const cacheKey = `${StorageKeys.GITHUB_CACHE}_pr_enrich_${repo}_${pr.number}_${includeReviews ? 'full' : 'lite'}`;
  
  // Tier 3: SHA-based invalidation
  const cached = storage.getCachedBySha<EnrichedPullRequest>(cacheKey, pr.head.sha);
  if (cached) return cached;

  // Try GraphQL first as it's much faster (1 request vs 4)
  if (token) {
    try {
      const enriched = await enrichSinglePrGraphQL(repo, pr, token, includeReviews);
      storage.setCached(cacheKey, enriched);
      return enriched;
    } catch (e) {
      console.warn("[GithubService] GraphQL enrichment failed, falling back to REST:", e);
    }
  }

  // REST Fallback
  // Tier 1: Use 'pr' object directly, only fetch details if missing changed_files
  const detailsPromise = (pr as any).changed_files !== undefined 
    ? Promise.resolve(pr as any) 
    : fetchPrDetails(repo, pr.number, token);

  const [details, reviews, checkResults] = await Promise.all([
    detailsPromise,
    (token && includeReviews) ? fetchPrReviews(repo, pr.number, token) : Promise.resolve([]),
    token ? fetchCheckRuns(repo, pr.head.sha, token) : Promise.resolve([])
  ]);

  // Conditional fetching for commit status (only if check runs are empty)
  let commitStatus = { state: 'unknown', statuses: [] as any[] };
  if (token && checkResults.length === 0) {
    commitStatus = await fetchCombinedStatus(repo, pr.head.sha, token);
  }

  // Merge Check Runs and Statuses
  // Check Runs are from the Checks API (modern), Statuses are from the Commits API (legacy)
  // We merge both to get a complete picture of the commit health.
  const allChecks = [
    ...checkResults,
    ...commitStatus.statuses
  ];

  const testStatus = deriveTestStatus(allChecks, commitStatus.state);

  const latestReviewsByUser: Record<string, string> = {};
  reviews.forEach(r => { latestReviewsByUser[r.user.login] = r.state; });
  const reviewStates = Object.values(latestReviewsByUser);
  const isApproved = reviewStates.includes('APPROVED') && !reviewStates.includes('CHANGES_REQUESTED');

  const enrichedPr = {
    ...details,
    testStatus,
    checkResults: allChecks,
    isApproved,
    isBig: (details.changed_files || 0) > 15,
    isReadyToMerge: details.mergeable === true,
    isLeaderBranch: ['leader', 'main', 'master', 'develop'].includes(details.base.ref.toLowerCase())
  } as EnrichedPullRequest;

  storage.setCached(cacheKey, enrichedPr);
  return enrichedPr;
};

/**
 * HIGH-SPEED PARALLEL ENRICHMENT
 */
export const fetchEnrichedPullRequests = async (repo: string, token?: string, skipCache = false): Promise<EnrichedPullRequest[]> => {
  const list = await fetchPullRequests(repo, token, 'open', skipCache);
  const subset = list.slice(0, 20);
  
  // Process in smaller chunks to avoid hitting browser/GitHub limits simultaneously
  const chunkSize = 5;
  const enrichedResults: EnrichedPullRequest[] = [];
  
  for (let i = 0; i < subset.length; i += chunkSize) {
    const chunk = subset.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(async (pr) => {
      try {
        // Tier 2: includeReviews = false for the list view
        return await enrichSinglePr(repo, pr, token, false);
      } catch (e) {
        return { ...pr, testStatus: 'unknown', isApproved: false, isBig: false, isReadyToMerge: false, isLeaderBranch: false } as EnrichedPullRequest;
      }
    }));
    enrichedResults.push(...chunkResults);
  }

  const nonEnriched = list.slice(20).map(pr => ({
    ...pr,
    testStatus: 'unknown',
    isApproved: false,
    isBig: false,
    isReadyToMerge: false,
    isLeaderBranch: false
  } as EnrichedPullRequest));

  return [...enrichedResults, ...nonEnriched];
};

export const fetchCoreRepoContext = async (repo: string, token: string) => {
  const [root, readme, pkg, ci] = await Promise.all([
    request<any[]>(`/repos/${repo}/contents/`, token).catch(() => []),
    request<string>(`/repos/${repo}/contents/README.md`, token, {}, true).catch(() => ""),
    request<string>(`/repos/${repo}/contents/package.json`, token, {}, true).catch(() => ""),
    request<any[]>(`/repos/${repo}/contents/.github/workflows`, token).catch(() => [])
  ]);

  return {
    fileList: Array.isArray(root) ? root.map(f => f.path).join(', ') : 'unknown',
    readmeSnippet: readme.substring(0, 1500),
    packageJson: pkg.substring(0, 1500),
    hasCI: Array.isArray(ci) && ci.length > 0
  };
};

export const fetchRepoContent = async (repo: string, path: string, token: string): Promise<any> => {
  try {
    const data = await request<any>(`/repos/${repo}/contents/${path}`, token);
    if (!Array.isArray(data) && data.content && data.encoding === 'base64') {
        try {
          return atob(data.content.replace(/\n/g, ''));
        } catch (decodeError) {
          console.error(`[githubService] Failed to decode base64 content for ${path}:`, decodeError);
          throw new Error(`Failed to decode file content for ${path}. The data might be malformed.`);
        }
    }
    return data;
  } catch (e) { return null; }
};
