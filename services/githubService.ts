
import { GithubIssue, GithubPullRequest, RepoStats } from '../types';

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
    body: JSON.stringify({ labels }), // Github API expects { labels: ["Label 1"] }
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