
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
    errorSnippet: string;
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

// Audit Types
export type AuditAgentType = 'full-stack' | 'testing' | 'performance' | 'frontend' | 'cicd' | 'security';

export interface ProposedIssue {
  title: string;
  body: string;
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  effort: 'Small' | 'Medium' | 'Large';
  labels: string[];
}

export interface TechnicalAuditResult {
  agentType: AuditAgentType;
  report: string;
  timestamp: number;
  criticalFindings: string[];
  suggestedIssues: ProposedIssue[];
  score: number; // 1-100
}

export interface BacklogTransformation {
  type: 'CONSOLIDATE' | 'REPLACE' | 'TRIAGE_ONLY' | 'PRUNE';
  targetIssueNumbers: number[];
  proposedIssue?: {
    title: string;
    body: string;
    labels: string[];
    priority: 'High' | 'Medium' | 'Low';
    effort: 'Small' | 'Medium' | 'Large';
  };
  reason: string;
  impact: string;
}

export interface BacklogMaintenanceResult {
  summary: string;
  transformations: BacklogTransformation[];
  healthScore: number;
}

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

export interface IssueImprovementRecommendation {
  issueNumber: number;
  title: string;
  suggestedTitle: string;
  suggestedBody: string;
  reason: string;
}

export interface IssueStalenessRecommendation {
  issueNumber: number;
  title: string;
  reason: string;
}

export interface QualityAnalysisResult {
  summary: string;
  improvements: IssueImprovementRecommendation[];
  closures: IssueStalenessRecommendation[];
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
  prTitle?: string;
  prState?: string;
  issueTitle?: string;
  issueState?: string;
}

export interface JulesAgentAction {
  sessionName: string;
  action: 'delete' | 'recover' | 'publish' | 'message' | 'start_over';
  reason: string;
  suggestedCommand?: string;
  hasPr: boolean;
  prStatus?: string;
}

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
  sessionTitle?: string;
  reason: string;
  status: 'merged' | 'closed' | 'stale' | 'failed' | 'redundant';
  publishedPrs: Array<{
    number: number;
    url: string;
    state: string;
    merged: boolean;
  }>;
  relatedIssueNumber?: number;
}

export interface PrCleanupRecommendation {
  prNumber: number;
  title: string;
  reason: string;
  action: 'close' | 'comment';
  evidenceLinks: Array<{
    type: 'issue' | 'pr';
    number: number;
    url: string;
    state: string;
  }>;
}

export interface JulesCleanupResult {
  report: string;
  candidates: JulesCleanupRecommendation[];
}

export interface PrCleanupResult {
  report: string;
  candidates: PrCleanupRecommendation[];
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

export interface MergeProposal {
  groupName: string;
  prNumbers: number[];
  branches: string[];
  reason: string;
  risk: 'Low' | 'Medium' | 'High';
  targetBranch: string;
}

export interface CodeReviewResult {
  reviewComment: string;
  labels: string[];
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
