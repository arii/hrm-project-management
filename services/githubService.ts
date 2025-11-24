
import { GithubIssue, GithubPullRequest, RepoStats, EnrichedPullRequest } from '../types';

const BASE_URL = 'https://api.github.com';

// Helper for headers
const getHeaders = (token?: string) => {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }
  return headers;
};

export const fetchRepoStats = async (repo: string, token?: string): Promise<RepoStats> => {
  const response = await fetch(`${BASE_URL}/repos/${repo}`, {
    headers: getHeaders(token),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch repo info: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    openIssuesCount: data.open_issues_count, // Note: this includes PRs in the API
    openPRsCount: 0, // Need to fetch separately to be accurate or calculate
    lastUpdated: data.updated_at,
    stars: data.stargazers_count,
    forks: data.forks_count,
  };
};

export const fetchIssues = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubIssue[]> => {
  // Fetch only actual issues, not PRs
  const response = await fetch(`${BASE_URL}/repos/${repo}/issues?state=${state}&per_page=100`, {
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch issues: ${response.statusText}`);
  }

  const data: GithubIssue[] = await response.json();
  // Filter out PRs (GitHub API returns PRs in the issues endpoint)
  return data.filter(item => !item.pull_request);
};

export const fetchPullRequests = async (repo: string, token?: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubPullRequest[]> => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/pulls?state=${state}&per_page=100`, {
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PRs: ${response.statusText}`);
  }

  return await response.json();
};

export const fetchPrDetails = async (repo: string, number: number, token?: string): Promise<GithubPullRequest> => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/pulls/${number}`, {
    headers: getHeaders(token),
  });
  if (!response.ok) throw new Error("Failed to fetch PR details");
  return await response.json();
};

// NEW: Fetch Enriched PRs (Details + Comments for Tests)
export const fetchEnrichedPullRequests = async (repo: string, token?: string): Promise<EnrichedPullRequest[]> => {
  // 1. Get List
  const list = await fetchPullRequests(repo, token, 'open');
  
  // 2. Fetch Details & Comments in parallel, with Retry for Mergeability
  const subset = list.slice(0, 20); 

  const enriched = await Promise.all(subset.map(async (pr) => {
    try {
      // Fetch details first to handle potential retries for mergeable status
      let details = await fetchPrDetails(repo, pr.number, token);

      // Retry logic: If mergeable is null, GitHub is computing it. Wait and retry.
      let retries = 0;
      while (details.mergeable === null && retries < 3) {
         await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s
         details = await fetchPrDetails(repo, pr.number, token);
         retries++;
      }

      // Fetch comments for test status
      const comments = await fetchComments(repo, pr.number, token);

      // Logic: Check comments for test results (Newest first)
      const sortedComments = Array.isArray(comments) 
        ? comments.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) 
        : [];
      
      let testStatus: 'passed' | 'failed' | 'pending' | 'unknown' = 'unknown';
      
      for (const c of sortedComments) {
        const body = (c.body || '').toLowerCase();
        // Check for common CI/CD bot messages
        if (body.includes('test failed') || body.includes('tests failed') || body.includes('build failed') || body.includes('checks failed') || body.includes('failure')) {
           testStatus = 'failed';
           break;
        }
        if (body.includes('test passed') || body.includes('tests passed') || body.includes('all checks passed') || body.includes('build success') || body.includes('successful')) {
           testStatus = 'passed';
           break;
        }
      }

      // Logic: Big PR?
      const filesChanged = details.changed_files || 0;
      const isBig = filesChanged > 15 || (details.additions || 0) > 500;

      // Logic: Ready to Merge?
      // Expanded Leader branch definition to include typical production/staging branches
      const isLeaderBranch = ['main', 'master', 'develop', 'dev', 'staging', 'release'].includes(details.base.ref.toLowerCase());
      const noConflicts = details.mergeable === true;
      
      let isReadyToMerge = false;
      
      if (noConflicts) {
        if (testStatus === 'failed') {
          // If tests explicitly failed, it is NEVER ready, regardless of branch
          isReadyToMerge = false;
        } else if (!isLeaderBranch) {
          // Non-leader branches are ready if no conflicts (unless tests failed)
          isReadyToMerge = true;
        } else {
          // Leader branches MUST have passing tests
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
      // Fallback to basic info
      return {
         ...pr,
         testStatus: 'unknown',
         isBig: false,
         isReadyToMerge: false,
         isLeaderBranch: false
      } as EnrichedPullRequest;
    }
  }));

  return enriched;
};

// NEW: Fetch recent activity for charts (Issues updated in last X days)
export const fetchRecentActivity = async (repo: string, token?: string, days = 30): Promise<GithubIssue[]> => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const since = date.toISOString();

  const response = await fetch(`${BASE_URL}/repos/${repo}/issues?state=all&since=${since}&per_page=100`, {
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch activity: ${response.statusText}`);
  }
  
  const data: GithubIssue[] = await response.json();
  return data.filter(item => !item.pull_request);
};

export const fetchComments = async (repo: string, issueNumber: number, token?: string) => {
   const response = await fetch(`${BASE_URL}/repos/${repo}/issues/${issueNumber}/comments`, {
    headers: getHeaders(token),
  });
  if (!response.ok) return [];
  return await response.json();
};

export const createIssue = async (repo: string, token: string, issue: { title: string; body: string; labels?: string[] }) => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/issues`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(issue),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Failed to create issue');
  }

  return await response.json();
};

export const updateIssue = async (repo: string, token: string, number: number, updates: { state?: 'open' | 'closed'; labels?: string[] }) => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/issues/${number}`, {
    method: 'PATCH',
    headers: getHeaders(token),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error('Failed to update issue/PR');
  }
  return await response.json();
};

export const addLabels = async (repo: string, token: string, number: number, labels: string[]) => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/issues/${number}/labels`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ labels }), 
  });

  if (!response.ok) {
    throw new Error('Failed to add labels');
  }
  return await response.json();
};

export const addComment = async (repo: string, token: string, number: number, body: string) => {
  const response = await fetch(`${BASE_URL}/repos/${repo}/issues/${number}/comments`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error('Failed to add comment');
  }
  return await response.json();
};
