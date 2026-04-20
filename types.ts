
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
  labels: GithubLabel[];
  mergeable?: boolean | null;
  mergeable_state?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  comments?: number;
}

export interface EnrichedPullRequest extends GithubPullRequest {
  testStatus: 'passed' | 'failed' | 'pending' | 'unknown';
  checkResults?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    url: string;
  }>;
  isBig: boolean;
  isReadyToMerge: boolean;
  isLeaderBranch: boolean;
  isApproved: boolean;
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

export interface WorkflowAnalysis {
  healthScore: number;
  summary: string;
  technicalFindings: Array<{
    type: 'failure' | 'warning' | 'info';
    title: string;
    description: string;
    location?: string;
    remediation?: string;
  }>;
  qualitativeAnalysis: {
    efficacy: string;
    coverage: string;
    efficiency: string;
    recommendations: string[];
  };
}

export interface GithubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title: string;
  raw_details: string | null;
}

// Workflow Health Types
export interface GithubWorkflowRun {
  id: number;
  name: string;
  node_id: string;
  head_branch: string;
  head_sha: string;
  run_number: number;
  event: string;
  status: string;
  conclusion: string | null;
  workflow_id: number;
  url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  check_suite_id?: number;
}

export interface GithubWorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  html_url: string;
  check_run_url: string;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface WorkflowHealthResult {
  report: string;
  syntaxFailures: Array<{
    workflowName: string;
    reason: string;
    fileUrl?: string;
    suggestedTitle: string;
    suggestedBody: string;
  }>;
  runtimeErrors: Array<{
    runId: number;
    jobName: string;
    stepName?: string;
    errorSnippet: string;
    rootCause?: string;
    fixCategory?: string;
    fixInstructions?: string;
    confidence: 'high' | 'medium' | 'low';
    suggestedTitle: string;
    suggestedBody: string;
  }>;
  falsePositives: Array<{
    jobName: string;
    reason: string;
    flakinessScore: number; // 1-10
    suggestedTitle: string;
    suggestedBody: string;
  }>;
}

export interface WorkflowQualitativeResult {
  summary: string;
  efficacyScore: number; // 1-100
  efficiencyScore: number; // 1-100
  findings: Array<{
    type: 'efficacy' | 'coverage' | 'duplicate' | 'inefficient';
    severity: 'critical' | 'moderate' | 'low';
    title: string;
    description: string;
    recommendation: string;
    suggestedTitle: string;
    suggestedBody: string;
  }>;
}

export interface ProposedIssue {
  title: string;
  body: string;
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  effort: 'Small' | 'Medium' | 'Large';
  labels: string[];
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
  prTitle?: string;
  prState?: string;
  issueTitle?: string;
  issueState?: string;
}

export interface PrHealthAction {
  prNumber: number;
  title: string;
  action: 'close' | 'comment' | 'label' | 'publish';
  label?: string;
  reason: string;
  suggestedComment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PrHealthAnalysisResult {
  report: string;
  actions: PrHealthAction[];
}

export interface CodeReviewResult {
  reviewComment: string;
  labels: string[];
  recommendation?: 'Approved' | 'Approved with Minor Changes' | 'Not Approved';
  suggestedIssues?: ProposedIssue[];
}

export interface RecoveryAnalysisResult {
  recommendation: 'REPAIR' | 'REWRITE';
  reason: string;
  julesPrompt: string;
}

export interface JulesSource {
  name: string;
  displayName?: string;
}

export interface JulesSession {
  name: string;
  state: 
    | 'STATE_UNSPECIFIED' 
    | 'PENDING' 
    | 'RUNNING' 
    | 'SUCCEEDED' 
    | 'FAILED' 
    | 'CANCELLED' 
    | 'TERMINATED'
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
