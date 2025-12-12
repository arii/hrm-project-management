
export interface GithubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GithubLabel {
  id: number;
  name: string;
  color: string;
  description: string;
}

export interface GithubIssue {
  id: number;
  number: number;
  title: string;
  user: GithubUser;
  state: 'open' | 'closed';
  html_url: string;
  body: string;
  created_at: string;
  updated_at: string;
  labels: GithubLabel[];
  pull_request?: {
    url: string;
    html_url: string;
  };
}

export interface GithubPullRequest {
  id: number;
  node_id: string;
  number: number;
  title: string;
  user: GithubUser;
  state: 'open' | 'closed';
  html_url: string;
  body: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  draft: boolean;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  // Detailed fields (may require fetching single PR endpoint)
  mergeable?: boolean | null;
  mergeable_state?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  comments?: number;
}

export interface EnrichedPullRequest extends GithubPullRequest {
  testStatus: 'passed' | 'failed' | 'pending' | 'unknown';
  isBig: boolean;
  isReadyToMerge: boolean;
  isLeaderBranch: boolean;
}

export interface GithubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface RepoStats {
  openIssuesCount: number;
  openPRsCount: number;
  lastUpdated: string;
  stars: number;
  forks: number;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
  RETRYING = 'RETRYING'
}

export interface AnalysisResult {
  markdown: string;
  timestamp: string;
}

export interface RedundancyGroup {
  topic: string;
  issueNumbers: number[];
  reason: string;
}

// Structured Redundancy Analysis
export interface RedundancyAnalysisResult {
  summary: string;
  redundantIssues: {
    issueNumber: number;
    reason: string;
  }[];
  consolidatedIssues: {
    title: string;
    body: string;
    labels: string[];
    reason: string;
    replacesIssueNumbers: number[];
  }[];
}

// Structured Triage Analysis
export interface TriageAction {
  issueNumber: number;
  title: string;
  suggestedLabels: string[];
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  effort: 'Small' | 'Medium' | 'Large';
  category: string;
}

export interface TriageAnalysisResult {
  report: string;
  actions: TriageAction[];
}

// AI Agent Types
export interface ProposedIssue {
  title: string;
  body: string;
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  effort: 'Small' | 'Medium' | 'Large';
  labels: string[];
}

export interface ArchitectAnalysisResult {
  issues: ProposedIssue[];
  suggestedPivot?: {
    mode: string;
    guidance: string;
    reason: string;
  };
}

export interface PrActionRecommendation {
  prNumber: number;
  action: 'close' | 'prioritize' | 'comment' | 'publish';
  reason: string;
  suggestedComment?: string;
}

export interface LinkSuggestion {
  prNumber: number;
  issueNumber: number;
  confidence: string;
  reason: string;
  // Enhanced fields for UI context
  prTitle?: string;
  prState?: string;
  issueTitle?: string;
  issueState?: string;
}

export interface JulesAgentAction {
  sessionName: string; // Full name
  action: 'delete' | 'recover' | 'publish' | 'message' | 'start_over';
  reason: string;
  suggestedCommand?: string;
}

// Cleanup Types
export interface CleanupRecommendation {
  issueNumber: number;
  action: 'close' | 'comment';
  reason: string;
  prReference?: number;
  sessionReference?: string;
  commentBody?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CleanupAnalysisResult {
  report: string;
  actions: CleanupRecommendation[];
}

export interface BranchCleanupRecommendation {
  branchName: string;
  reason: string;
  type: 'merged' | 'stale' | 'abandoned';
  confidence: 'high' | 'medium' | 'low';
}

export interface BranchCleanupResult {
  report: string;
  candidates: BranchCleanupRecommendation[];
}

export interface JulesCleanupRecommendation {
  sessionName: string;
  reason: string;
  linkedPrNumber?: number;
  status: 'merged' | 'closed' | 'stale' | 'failed';
}

export interface JulesCleanupResult {
  report: string;
  candidates: JulesCleanupRecommendation[];
}

// PR Health Types
export interface PrHealthAction {
  prNumber: number;
  title: string;
  action: 'close' | 'comment' | 'label';
  label?: string; // If action is label
  reason: string;
  suggestedComment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PrHealthAnalysisResult {
  report: string;
  actions: PrHealthAction[];
}

// Integrator (Merge Ops) Types
export interface MergeProposal {
  groupName: string;
  prNumbers: number[];
  branches: string[];
  reason: string;
  risk: 'Low' | 'Medium' | 'High';
  targetBranch: string;
}

// Code Review Types
export interface CodeReviewResult {
  reviewComment: string;
  labels: string[];
}

// Jules API Types
export interface JulesSource {
  name: string;
  displayName?: string;
}

export interface JulesSession {
  name: string; // Resource name: projects/.../sessions/...
  state: 
    | 'STATE_UNSPECIFIED' 
    | 'PENDING' 
    | 'RUNNING' 
    | 'SUCCEEDED' 
    | 'FAILED' 
    | 'CANCELLED' 
    | 'TERMINATED'
    // Granular states
    | 'IN_PROGRESS'
    | 'AWAITING_USER_FEEDBACK'
    | 'AWAITING_PLAN_APPROVAL'
    | 'COMPLETED';
  createTime: string;
  updateTime?: string;
  title?: string;
  outputs?: Array<{
    pullRequest?: {
      url: string;
    };
  }>;
  sourceContext?: {
    source: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}
