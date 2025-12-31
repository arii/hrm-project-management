
import { GithubIssue, GithubPullRequest, RepoStats, EnrichedPullRequest, GithubBranch, GithubWorkflowRun, GithubWorkflowJob } from '../types';
import { storage, StorageKeys } from './storageService';

const BASE_URL = 'https://api.github.com';
const CACHE_DURATION = 15 * 60 * 1000;

const request = async <T>(endpoint: string, token: string | undefined, options: RequestInit = {}, isText = false): Promise<T> => {
  const isGet = !options.method || options.method === 'GET';
  const customHeaders = options.headers as Record<string, string> | undefined;
  const skipCache = customHeaders?.['X-Skip-Cache'] === 'true';
  const cacheKey = `${StorageKeys.GITHUB_CACHE}_${endpoint}`;

  if (isGet && !skipCache && !isText) {
    const cached = storage.get<{ timestamp: number; data: any } | null>(cacheKey, null);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data as T;
    }
  }

  const headers: HeadersInit = {
    'Accept': isText ? 'application/vnd.github.v3.diff' : 'application/vnd.github.v3+json',
    ...options.headers,
  };

  if (!isText && !headers['Content-Type']) {
     // @ts-ignore
     headers['Content-Type'] = 'application/json';
  }
  
  if (token && token.trim()) {
    headers['Authorization'] = `token ${token.trim()}`;
  }

  const fetchOptions = { ...options };
  if (fetchOptions.headers) {
     const h = { ...(fetchOptions.headers as any) };
     if (h['X-Skip-Cache']) delete h['X-Skip-Cache'];
     fetchOptions.headers = h;
  }

  let response: Response | undefined;
  let retries = 2;
  while (retries >= 0) {
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        ...fetchOptions,
        headers: { ...headers, ...fetchOptions.headers },
      });
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
          throw new Error("GitHub API Rate Limit Exceeded.");
      }
      break;
    } catch (e: any) {
      if (retries === 0) throw e;
      retries--;
      await new Promise(r => setTimeout(r, 1000 * (2 - retries))); 
    }
  }

  if (!response) throw new Error("Unknown network error");

  if (!response.ok) {
    let errorMessage = `Error: ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.message) errorMessage = errorBody.message;
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

export const fetchRepoStats = async (repo: string, token?: string): Promise<RepoStats> => {
  const data = await request<any>(`/repos/${repo}`, token);
  return {
    openIssuesCount: data.open_issues_count,
    openPRsCount: 0,
    lastUpdated: data.updated_at,
    stars: data.stargazers_count,
    forks: data.forks_count,
  };
};

export const fetchIssues = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubIssue[]> => {
  const data = await request<GithubIssue[]>(`/repos/${repo}/issues?state=${state}&per_page=100`, token);
  return data.filter(item => !item.pull_request);
};

export const fetchPullRequests = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open', skipCache = false): Promise<GithubPullRequest[]> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  return request<GithubPullRequest[]>(`/repos/${repo}/pulls?state=${state}&per_page=100`, token, options);
};

export const fetchPrDetails = async (repo: string, number: number, token?: string, skipCache = false): Promise<GithubPullRequest> => {
  const options = skipCache ? { headers: { 'X-Skip-Cache': 'true' } } : {};
  return request<GithubPullRequest>(`/repos/${repo}/pulls/${number}`, token, options);
};

export const fetchPrReviews = async (repo: string, number: number, token?: string) => {
  return request<any[]>(`/repos/${repo}/pulls/${number}/reviews`, token);
};

export const fetchPrDiff = async (repo: string, number: number, token: string): Promise<string> => {
  return request<string>(`/repos/${repo}/pulls/${number}`, token, {}, true);
};

export const fetchPrsForCommit = async (repo: string, commitSha: string, token: string): Promise<GithubPullRequest[]> => {
  return request<GithubPullRequest[]>(`/repos/${repo}/commits/${commitSha}/pulls`, token);
};

export const fetchCheckRuns = async (repo: string, ref: string, token: string) => {
  try {
    const data = await request<any>(`/repos/${repo}/commits/${ref}/check-runs`, token);
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

export const fetchBranches = async (repo: string, token: string): Promise<GithubBranch[]> => {
  return request<GithubBranch[]>(`/repos/${repo}/branches?per_page=100`, token);
};

export const fetchWorkflowRuns = async (repo: string, token: string): Promise<GithubWorkflowRun[]> => {
  const data = await request<{ workflow_runs: GithubWorkflowRun[] }>(`/repos/${repo}/actions/runs?per_page=50`, token);
  return data.workflow_runs || [];
};

export const fetchWorkflowRunJobs = async (repo: string, runId: number, token: string): Promise<GithubWorkflowJob[]> => {
  const data = await request<{ jobs: GithubWorkflowJob[] }>(`/repos/${repo}/actions/runs/${runId}/jobs`, token);
  return data.jobs || [];
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

export const deleteBranch = async (repo: string, token: string, branchName: string) => {
  const refPath = branchName.split('/').map(encodeURIComponent).join('/');
  return request(`/repos/${repo}/git/refs/heads/${refPath}`, token, { method: 'DELETE' });
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

export const fetchEnrichedPullRequests = async (repo: string, token?: string, skipCache = false): Promise<EnrichedPullRequest[]> => {
  const list = await fetchPullRequests(repo, token, 'open', skipCache);
  const subset = list.slice(0, 50);
  const results: EnrichedPullRequest[] = [];
  
  for (const pr of subset) {
    try {
      const details = await fetchPrDetails(repo, pr.number, token, skipCache);
      const reviews = token ? await fetchPrReviews(repo, pr.number, token) : [];
      let checkResults = [];
      let testStatus: 'passed' | 'failed' | 'pending' | 'unknown' = 'unknown';
      
      if (token) {
        checkResults = await fetchCheckRuns(repo, pr.head.sha, token);
        const failedCount = checkResults.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out').length;
        const pendingCount = checkResults.filter(r => r.status !== 'completed').length;
        
        if (failedCount > 0) testStatus = 'failed';
        else if (pendingCount > 0) testStatus = 'pending';
        else if (checkResults.length > 0) testStatus = 'passed';
      }

      // Check if approved: has at least one 'APPROVED' and no 'CHANGES_REQUESTED' in the latest reviews from each user
      const latestReviewsByUser: Record<string, string> = {};
      reviews.forEach(r => {
        latestReviewsByUser[r.user.login] = r.state;
      });
      const reviewStates = Object.values(latestReviewsByUser);
      const isApproved = reviewStates.includes('APPROVED') && !reviewStates.includes('CHANGES_REQUESTED');

      results.push({
        ...details,
        testStatus,
        checkResults,
        isApproved,
        isBig: (details.changed_files || 0) > 15,
        isReadyToMerge: details.mergeable === true,
        isLeaderBranch: ['leader', 'main', 'master', 'develop'].includes(details.base.ref.toLowerCase())
      });
    } catch (e) { 
      results.push({ ...pr, testStatus: 'unknown', isApproved: false, isBig: false, isReadyToMerge: false, isLeaderBranch: false } as EnrichedPullRequest); 
    }
  }
  return results;
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

export const fetchRepoTemplates = async (repo: string, token: string) => {
  const paths = [
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md',
    '.github/CONTRIBUTING.md',
    'CONTRIBUTING.md',
    'AUDIT.md',
    'HACKING.md',
    'DEVELOPMENT.md'
  ];
  
  const contents = await Promise.all(paths.map(path => fetchRepoContent(repo, path, token)));
  return paths.reduce((acc, path, i) => {
    if (contents[i]) acc[path] = contents[i].substring(0, 1000);
    return acc;
  }, {} as Record<string, string>);
};

export const fetchRepoContent = async (repo: string, path: string, token: string): Promise<any> => {
  try {
    const data = await request<any>(`/repos/${repo}/contents/${path}`, token);
    if (!Array.isArray(data) && data.content && data.encoding === 'base64') {
        return atob(data.content.replace(/\n/g, ''));
    }
    return data;
  } catch (e) { return null; }
};

export const prefetchRepositoryData = async (repo: string, token: string) => {
  const [issues, prs, closedPrs] = await Promise.all([
    fetchIssues(repo, token, 'open'),
    fetchPullRequests(repo, token, 'open'),
    fetchPullRequests(repo, token, 'closed'),
  ]);
  return { issues, prs, closedPrs };
};
