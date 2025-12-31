
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, PrActionRecommendation, LinkSuggestion, CleanupAnalysisResult, RedundancyAnalysisResult, TriageAnalysisResult, BranchCleanupResult, JulesSession, JulesAgentAction, EnrichedPullRequest, PrHealthAnalysisResult, MergeProposal, JulesCleanupResult, ArchitectAnalysisResult, CodeReviewResult, QualityAnalysisResult, RecoveryAnalysisResult, RepoStats, AuditAgentType, TechnicalAuditResult, BacklogMaintenanceResult, PrCleanupResult, GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, WorkflowQualitativeResult } from '../types';

/**
 * Clean a string that might contain Markdown JSON code blocks
 */
const cleanJsonString = (str: string): string => {
  return str.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
};

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please check your settings.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Ensures the user has selected a Pro API key if using a Pro model.
 */
const ensureProApiKey = async () => {
  // @ts-ignore
  if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
    }
  }
};

export const generateRepoBriefing = async (
  stats: RepoStats, 
  velocity: { opened: number, closed: number }, 
  recentIssues: GithubIssue[], 
  recentPrs: GithubPullRequest[]
): Promise<string> => {
  const client = getClient();
  const prompt = `
    Generate a high-level executive briefing for the repository based on these stats:
    Stats: Stars: ${stats.stars}, Forks: ${stats.forks}, Open Issues: ${stats.openIssuesCount}, Open PRs: ${stats.openPRsCount}.
    Activity (Last 7 days): ${velocity.opened} opened, ${velocity.closed} closed.
    Recent Issues: ${recentIssues.map(i => i.title).join(', ')}
    Recent PRs: ${recentPrs.map(p => p.title).join(', ')}
    Provide a Markdown summary focusing on health and immediate priorities.
  `;
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });
  return response.text || "No briefing available.";
};

export const analyzeWorkflowHealth = async (run: GithubWorkflowRun, jobs: GithubWorkflowJob[]): Promise<WorkflowHealthResult> => {
  const client = getClient();
  
  const runContext = {
    id: run.id,
    name: run.name,
    conclusion: run.conclusion,
    status: run.status,
    head_branch: run.head_branch,
    event: run.event,
    jobs: jobs.map(j => ({ 
      name: j.name, 
      conclusion: j.conclusion, 
      status: j.status,
      steps: j.steps.map(s => ({ name: s.name, conclusion: s.conclusion, status: s.status }))
    }))
  };

  const prompt = `
    Analyze a specific GitHub Actions Workflow Run for failures, flakes, or syntax issues.
    
    GOAL: Provide a deep technical audit of this specific run.
    
    RUN DATA:
    ${JSON.stringify(runContext)}

    INSTRUCTIONS:
    1. If the run failed, explain exactly WHY based on the job/step outcomes.
    2. Identify if this looks like a flaky test (e.g. random step failure in a mature job).
    3. Generate high-quality suggested titles and bodies for GitHub issues if a fix is needed.
    4. The 'report' property should be a detailed Markdown analysis of this specific run.
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          syntaxFailures: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                workflowName: { type: Type.STRING },
                reason: { type: Type.STRING },
                fileUrl: { type: Type.STRING, nullable: true },
                suggestedTitle: { type: Type.STRING },
                suggestedBody: { type: Type.STRING }
              },
              required: ['workflowName', 'reason', 'suggestedTitle', 'suggestedBody']
            }
          },
          runtimeErrors: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                runId: { type: Type.INTEGER },
                jobName: { type: Type.STRING },
                errorSnippet: { type: Type.STRING },
                confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                suggestedTitle: { type: Type.STRING },
                suggestedBody: { type: Type.STRING }
              },
              required: ['runId', 'jobName', 'errorSnippet', 'confidence', 'suggestedTitle', 'suggestedBody']
            }
          },
          falsePositives: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                jobName: { type: Type.STRING },
                reason: { type: Type.STRING },
                flakinessScore: { type: Type.INTEGER },
                suggestedTitle: { type: Type.STRING },
                suggestedBody: { type: Type.STRING }
              },
              required: ['jobName', 'reason', 'flakinessScore', 'suggestedTitle', 'suggestedBody']
            }
          }
        },
        required: ['report', 'syntaxFailures', 'runtimeErrors', 'falsePositives']
      }
    }
  });

  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzeWorkflowQualitative = async (
  workflows: Array<{ name: string, path: string, content: string }>,
  runs: GithubWorkflowRun[],
  repoContext: { fileList: string, readmeSnippet: string, packageJson: string }
): Promise<WorkflowQualitativeResult> => {
  await ensureProApiKey();
  const client = getClient();
  
  const prompt = `
    Perform a QUALITATIVE AUDIT of CI/CD Workflows.
    
    GOAL: Evaluate the efficacy, coverage, redundancy, and efficiency of GitHub Actions.
    
    DATA PROVIDED:
    - Workflow Files: ${JSON.stringify(workflows.map(w => ({ name: w.name, content: w.content.substring(0, 2000) })))}
    - Recent Runs: ${JSON.stringify(runs.slice(0, 10).map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion, created: r.created_at })))}
    - Repo Context: Files present in root: ${repoContext.fileList}. Package.json: ${repoContext.packageJson}.
    
    ANALYSIS CRITERIA:
    1. EFFICACY: Do the tests actually catch bugs? Are they running on the right events (push, PR)?
    2. COVERAGE: What's missing? (e.g., repo has frontend files but no frontend tests, or has secrets but no secret scanner).
    3. DUPLICATE: Are multiple workflows doing the same thing? (e.g. two linting workflows).
    4. INEFFICIENT: Are jobs too slow? Are triggers too broad? Are they wasting minutes?
    
    OUTPUT: A JSON report with scores and specific actionable findings. 
    Findings should include 'suggestedTitle' and 'suggestedBody' for a GitHub Issue to fix the qualitative gap.
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          efficacyScore: { type: Type.INTEGER },
          efficiencyScore: { type: Type.INTEGER },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['efficacy', 'coverage', 'duplicate', 'inefficient'] },
                severity: { type: Type.STRING, enum: ['critical', 'moderate', 'low'] },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                recommendation: { type: Type.STRING },
                suggestedTitle: { type: Type.STRING },
                suggestedBody: { type: Type.STRING }
              },
              required: ['type', 'severity', 'title', 'description', 'recommendation', 'suggestedTitle', 'suggestedBody']
            }
          }
        },
        required: ['summary', 'efficacyScore', 'efficiencyScore', 'findings']
      }
    }
  });

  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzeBacklogMaintenance = async (issues: GithubIssue[], context: { templates: Record<string, string> }): Promise<BacklogMaintenanceResult> => {
  await ensureProApiKey();
  const client = getClient();
  const summary = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body || "",
    labels: i.labels.map(l => l.name)
  }));

  const prompt = `
    Perform a BACKLOG QUALITY AUDIT.
    GOAL: Evaluate every issue. If an issue is vague or lacks detail, propose a 'REFINE' transformation.
    The 'proposedIssue.body' MUST be extremely detailed, following repository standards, and include "Acceptance Criteria".
    Use the provided templates to align with standards.
    REPO STYLE CONTEXT: ${JSON.stringify(context.templates)}
    CURRENT ISSUES: ${JSON.stringify(summary)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          healthScore: { type: Type.INTEGER },
          transformations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['CONSOLIDATE', 'REPLACE', 'TRIAGE_ONLY', 'PRUNE'] },
                targetIssueNumbers: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                reason: { type: Type.STRING },
                impact: { type: Type.STRING },
                proposedIssue: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    body: { type: Type.STRING },
                    labels: { type: Type.ARRAY, items: { type: Type.STRING } },
                    priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                    effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] }
                  },
                  required: ['title', 'body', 'labels', 'priority', 'effort']
                }
              },
              required: ['type', 'targetIssueNumbers', 'reason', 'impact']
            }
          }
        },
        required: ['summary', 'healthScore', 'transformations']
      }
    }
  });

  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const runTechnicalAudit = async (
  agentType: AuditAgentType,
  context: { fileList: string, readmeSnippet: string, packageJson: string, hasCI: boolean }
): Promise<TechnicalAuditResult> => {
  const client = getClient();
  const prompt = `
    Perform a technical audit. Persona: ${agentType}. 
    Context: ${JSON.stringify(context)}.
    
    CRITICAL REQUIREMENT: For every item in 'suggestedIssues', the 'body' MUST be a comprehensive, step-by-step implementation guide. 
    It MUST include specific code samples or configuration snippets (e.g. YAML for CI/CD, TS for Fullstack) so the developer can implement it immediately.
    Do not be vague. Provide the actual code needed in the issue body.
  `;
  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          score: { type: Type.INTEGER },
          criticalFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedIssues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                body: { type: Type.STRING, description: "Detailed step-by-step guide with code snippets." },
                reason: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
                labels: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ['title', 'body', 'reason', 'priority', 'effort', 'labels']
            }
          }
        },
        required: ['report', 'score', 'criticalFindings', 'suggestedIssues']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzePullRequests = async (prs: GithubPullRequest[]): Promise<PrHealthAnalysisResult> => {
  const client = getClient();
  const summary = prs.map(p => ({ number: p.number, title: p.title, bodySnippet: p.body?.substring(0, 200) }));
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Audit PR health: ${JSON.stringify(summary)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          actions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { prNumber: { type: Type.INTEGER }, title: { type: Type.STRING }, action: { type: Type.STRING, enum: ['close', 'comment', 'label', 'publish'] }, label: { type: Type.STRING, nullable: true }, reason: { type: Type.STRING }, suggestedComment: { type: Type.STRING, nullable: true }, confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] } }, required: ['prNumber', 'title', 'action', 'reason', 'confidence'] } }
        },
        required: ['report', 'actions']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

/**
 * COMPREHENSIVE CODE REVIEW ENGINE
 */
export const generateCodeReview = async (pr: EnrichedPullRequest, diff: string): Promise<CodeReviewResult> => {
  await ensureProApiKey();
  const client = getClient();
  
  const checksSummary = pr.checkResults?.map(c => `- ${c.name}: ${c.status} (${c.conclusion || 'Pending'})`).join('\n') || "No checks found.";

  const prompt = `
    You are a Principal Software Engineer and Technical Architect.
    
    TASK: Provide a DEEP, COMPREHENSIVE Code Review for PR #${pr.number} - "${pr.title}".
    
    GUIDELINES:
    1. FILE-BY-FILE ANALYSIS: Group your feedback by file. For every major issue, provide a "Problem" description and an "Implementation Sample" (Actual code snippet).
    2. ARCHITECTURAL IMPACT: How does this change affect the overall system? 
    3. BEST PRACTICES: Check for type safety (TypeScript), performance bottlenecks, and security vulnerabilities.
    4. GITHUB CHECKS: I will provide the status of the automated tests (checks). Correlate any failures with the code changes in the diff.
    5. SUGGESTED ISSUES: For every item in the 'suggestedIssues' array, the 'body' MUST be a comprehensive, step-by-step implementation guide. 
       It MUST include the "Implementation Sample" (code snippet) mentioned in your analysis so the developer has everything they need in the issue itself.
    
    PR CONTEXT:
    Title: ${pr.title}
    Description: ${pr.body || "No description provided."}
    
    GITHUB CHECKS STATUS:
    ${checksSummary}
    
    DIFF DATA:
    ${diff.substring(0, 50000)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reviewComment: { type: Type.STRING, description: "Comprehensive Markdown review." },
          labels: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedIssues: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                title: { type: Type.STRING }, 
                body: { type: Type.STRING, description: "Detailed implementation specification including code snippets." }, 
                reason: { type: Type.STRING }, 
                priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] }, 
                effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] }, 
                labels: { type: Type.ARRAY, items: { type: Type.STRING } } 
              }, 
              required: ['title', 'body', 'reason', 'priority', 'effort', 'labels'] 
            } 
          }
        },
        required: ['reviewComment', 'labels']
      }
    }
  });

  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const extractIssuesFromComments = async (comments: Array<{ id: number, user: string, body: string, url: string }>): Promise<ProposedIssue[]> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
      Extract follow-up issues from these comments: ${JSON.stringify(comments)}.
      Each issue's 'body' MUST be a full implementation plan including any code suggestions mentioned in the comments.
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            body: { type: Type.STRING, description: "Detailed implementation plan extracted from comments." },
            reason: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
            labels: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['title', 'body', 'reason', 'priority', 'effort', 'labels']
        }
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "[]"));
};

export const analyzePrForRestart = async (pr: EnrichedPullRequest, diff: string): Promise<{ plan: string; title: string }> => {
  await ensureProApiKey();
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Analyze intent for fresh restart: ${diff.substring(0, 40000)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { plan: { type: Type.STRING }, title: { type: Type.STRING } },
        required: ['plan', 'title']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const parseIssuesFromText = async (text: string): Promise<ProposedIssue[]> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Extract tasks from this text: ${text}. Ensure bodies are comprehensive and contain all technical details and code found in the source.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            body: { type: Type.STRING, description: "Comprehensive implementation body." },
            priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
            labels: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['title', 'body', 'priority', 'effort', 'labels']
        }
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "[]"));
};

export const analyzeIssueRedundancy = async (issues: GithubIssue[]): Promise<RedundancyAnalysisResult> => {
  const client = getClient();
  const summary = issues.map(i => ({ number: i.number, title: i.title }));
  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Identify duplicate issues: ${JSON.stringify(summary)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          redundantIssues: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { issueNumber: { type: Type.INTEGER }, reason: { type: Type.STRING } }, required: ['issueNumber', 'reason'] } },
          consolidatedIssues: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, body: { type: Type.STRING }, labels: { type: Type.ARRAY, items: { type: Type.STRING } }, reason: { type: Type.STRING }, replacesIssueNumbers: { type: Type.ARRAY, items: { type: Type.INTEGER } } }, required: ['title', 'body', 'labels', 'reason', 'replacesIssueNumbers'] } }
        },
        required: ['summary', 'redundantIssues', 'consolidatedIssues']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const generateCleanupReport = async (openIssues: GithubIssue[], closedPrs: GithubPullRequest[]): Promise<CleanupAnalysisResult> => {
  const client = getClient();
  const issues = openIssues.map(i => ({ number: i.number, title: i.title }));
  // Strictly filter for PRs merged to leader
  const prs = closedPrs.filter(p => !!p.merged_at && ['leader', 'main', 'master'].includes(p.base.ref.toLowerCase())).map(p => ({ number: p.number, title: p.title }));
  
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Cleanup zombie issues: ${JSON.stringify(issues)} against PRs MERGED to leader: ${JSON.stringify(prs)}. ONLY suggest closing if the issue is solved by a MERGED PR on leader branch.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          actions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { issueNumber: { type: Type.INTEGER }, action: { type: Type.STRING, enum: ['close', 'comment'] }, reason: { type: Type.STRING }, confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] } }, required: ['issueNumber', 'action', 'reason', 'confidence'] } }
        },
        required: ['report', 'actions']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzeBranchCleanup = async (
  branches: string[], 
  openPrBranchRefs: string[], 
  closedPrBranchRefs: string[]
): Promise<BranchCleanupResult> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze branch hygiene: ${branches.join(',')}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          candidates: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { branchName: { type: Type.STRING }, reason: { type: Type.STRING }, type: { type: Type.STRING, enum: ['merged', 'stale', 'abandoned'] }, confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] } }, 
              required: ['branchName', 'reason', 'type', 'confidence'] 
            } 
          }
        },
        required: ['report', 'candidates']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzeJulesCleanup = async (
  sessions: JulesSession[], 
  allPrs: GithubPullRequest[],
  allIssues: GithubIssue[]
): Promise<JulesCleanupResult> => {
  const client = getClient();
  
  const prSummary = allPrs.map(p => ({ number: p.number, state: p.state, base: p.base.ref, merged: !!p.merged_at, url: p.html_url }));
  const issueSummary = allIssues.map(i => ({ number: i.number, state: i.state, title: i.title }));
  const sessionSummary = sessions.map(s => ({ 
    name: s.name, 
    title: s.title,
    state: s.state,
    prs: s.outputs?.filter(o => o.pullRequest).map(o => o.pullRequest?.url) || []
  }));

  const prompt = `
    JULES SESSION HYGIENE AUDIT.
    
    GOAL: Identify sessions to delete.
    STRICT CRITERIA FOR DELETION:
    1. The session published a PR that was successfully MERGED into the default 'leader' branch. (If PR is closed but NOT merged, do NOT delete session).
    2. The session was created for a specific issue number, and that issue is now marked as CLOSED.
    3. The session state is FAILED, CANCELLED, or TERMINATED and it's older than 7 days.
    
    RULES:
    - "CLOSED" PR does NOT equal "FIXED". Only "MERGED" to 'leader' counts.
    - If suggesting deletion based on a PR, you MUST specify the PR number and verify it has 'merged: true' in the provided data.
    
    DATA PROVIDED:
    - Jules Sessions: ${JSON.stringify(sessionSummary)}
    - Repo PRs: ${JSON.stringify(prSummary)}
    - Repo Issues: ${JSON.stringify(issueSummary)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          candidates: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                sessionName: { type: Type.STRING }, 
                sessionTitle: { type: Type.STRING },
                reason: { type: Type.STRING }, 
                status: { type: Type.STRING, enum: ['merged', 'closed', 'stale', 'failed', 'redundant'] },
                publishedPrs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      number: { type: Type.INTEGER },
                      url: { type: Type.STRING },
                      state: { type: Type.STRING },
                      merged: { type: Type.BOOLEAN }
                    },
                    required: ['number', 'url', 'state', 'merged']
                  }
                },
                relatedIssueNumber: { type: Type.INTEGER, nullable: true }
              }, 
              required: ['sessionName', 'reason', 'status', 'publishedPrs'] 
            } 
          }
        },
        required: ['report', 'candidates']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const analyzePrCleanup = async (
  openPrs: GithubPullRequest[],
  allIssues: GithubIssue[],
  closedPrs: GithubPullRequest[]
): Promise<PrCleanupResult> => {
  const client = getClient();
  const openPrData = openPrs.map(p => ({ number: p.number, title: p.title, body: p.body?.substring(0, 500) }));
  const issueData = allIssues.map(i => ({ number: i.number, state: i.state, title: i.title }));
  
  // Specifically pass merge info and target branch for closed PRs to verify "leader" merges
  const closedPrSummary = closedPrs.map(p => ({ 
    number: p.number, 
    title: p.title, 
    state: p.state, 
    url: p.html_url,
    merged: !!p.merged_at,
    base: p.base.ref
  }));

  const prompt = `
    PR HYGIENE AUDIT.
    
    GOAL: Identify open PRs that should be CLOSED.
    
    STRICT CRITERIA (Adhere strictly):
    1. FIXED BY ISSUE: The open PR claims to fix an issue (e.g. "Fixes #123") but that issue is ALREADY CLOSED.
    2. FIXED BY OTHER PR: The open PR is a duplicate of a PR that was already MERGED into the default 'leader' branch.
    
    CRITICAL RULES:
    - Only a PR "MERGED" into the default 'leader' branch satisfies the requirement to close a similar/redundant PR.
    - A "CLOSED" but "NOT MERGED" PR does NOT satisfy the fixed requirement.
    - Verification Requirement: For every candidate, you MUST provide 'evidenceLinks' pointing to the SPECIFIC MERGED PR (on leader) or the CLOSED ISSUE.
    
    DATA:
    - Open PRs: ${JSON.stringify(openPrData)}
    - Issues: ${JSON.stringify(issueData)}
    - Recently Closed PRs (includes merge status and target branch): ${JSON.stringify(closedPrSummary)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                prNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                reason: { type: Type.STRING },
                action: { type: Type.STRING, enum: ['close', 'comment'] },
                evidenceLinks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, enum: ['issue', 'pr'] },
                      number: { type: Type.INTEGER },
                      url: { type: Type.STRING },
                      state: { type: Type.STRING }
                    },
                    required: ['type', 'number', 'url', 'state']
                  }
                }
              },
              required: ['prNumber', 'title', 'reason', 'action', 'evidenceLinks']
            }
          }
        },
        required: ['report', 'candidates']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const suggestStrategicIssues = async (
  issues: GithubIssue[], 
  prs: GithubPullRequest[], 
  repoContext: { fileList: string, readmeSnippet: string, packageJson: string },
  guidance: string
): Promise<ArchitectAnalysisResult> => {
  await ensureProApiKey();
  const client = getClient();
  const issueSummary = issues.slice(0, 30).map(i => ({ title: i.title, state: i.state }));
  const prompt = `
    Strategic Audit. 
    Repo Context: ${repoContext.fileList}. 
    Existing Backlog: ${JSON.stringify(issueSummary)}. 
    Guidance: ${guidance}
    
    GOAL: Suggest high-impact issues. Each 'issue.body' MUST be a comprehensive, step-by-step implementation roadmap with code examples.
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          issues: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                title: { type: Type.STRING }, 
                body: { type: Type.STRING, description: "Detailed implementation roadmap with code snippets." }, 
                priority: { type: Type.STRING }, 
                effort: { type: Type.STRING }, 
                labels: { type: Type.ARRAY, items: { type: Type.STRING } }, 
                reason: { type: Type.STRING } 
              }, 
              required: ['title', 'body', 'priority', 'effort', 'labels', 'reason'] 
            } 
          },
        },
        required: ['issues']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "{}"));
};

export const auditPullRequests = async (prs: any[]): Promise<PrActionRecommendation[]> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Audit status of PRs.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { prNumber: { type: Type.INTEGER }, action: { type: Type.STRING }, reason: { type: Type.STRING } }, required: ['prNumber', 'action', 'reason'] } }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "[]"));
};

export const findIssuePrLinks = async (issues: any[], prs: any[]): Promise<LinkSuggestion[]> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Link related issues and PRs.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { prNumber: { type: Type.INTEGER }, issueNumber: { type: Type.INTEGER }, confidence: { type: Type.STRING }, reason: { type: Type.STRING } }, required: ['prNumber', 'issueNumber', 'confidence', 'reason'] } }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "[]"));
};

export const analyzeJulesSessions = async (sessions: JulesSession[], prs: EnrichedPullRequest[]): Promise<JulesAgentAction[]> => {
  const client = getClient();
  const sessionData = sessions.map(s => ({
    name: s.name,
    state: s.state,
    title: s.title,
    prs: s.outputs?.filter(o => o.pullRequest).map(o => o.pullRequest?.url) || []
  }));
  const prData = prs.map(p => ({
    number: p.number,
    url: p.html_url,
    testStatus: p.testStatus,
    isApproved: p.isApproved,
    state: p.state
  }));

  const prompt = `
    Analyze Jules Sessions Operator Tasks.
    
    GOAL: Identify sessions that are stuck or safe to prune.
    
    IDENTIFICATION RULES:
    1. STUCK SESSIONS: Session is 'SUCCEEDED' or 'COMPLETED' but has NO pull request URL in outputs. Action: 'message' or 'recover' to request PR creation.
    2. SAFE TO PRUNE: Session has an associated PR that is 'APPROVED', passing CI (testStatus: passed), and is already merged or ready to merge. Action: 'delete' to free up Jules resources.
    3. RESTART: Session has an associated PR that is 'FAILED' and has been stagnant. Action: 'start_over'.
    
    DATA:
    Sessions: ${JSON.stringify(sessionData)}
    Pull Requests: ${JSON.stringify(prData)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sessionName: { type: Type.STRING },
          action: { type: Type.STRING, enum: ['delete', 'recover', 'publish', 'message', 'start_over'] },
          reason: { type: Type.STRING },
          suggestedCommand: { type: Type.STRING, nullable: true },
          hasPr: { type: Type.BOOLEAN },
          prStatus: { type: Type.STRING, nullable: true }
        },
        required: ['sessionName', 'action', 'reason', 'hasPr']
      }
    }
  });
  return JSON.parse(cleanJsonString(response.text || "[]"));
};
