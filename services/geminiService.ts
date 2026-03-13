
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, EnrichedPullRequest, CodeReviewResult, GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, WorkflowQualitativeResult, GithubAnnotation, PrHealthAnalysisResult } from '../types';

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

export const analyzeWorkflowHealth = async (
  run: GithubWorkflowRun, 
  jobs: GithubWorkflowJob[], 
  annotations: Record<number, GithubAnnotation[]> = {}
): Promise<WorkflowHealthResult> => {
  const client = getClient();
  
  const runContext = {
    id: run.id,
    name: run.name,
    conclusion: run.conclusion,
    status: run.status,
    head_branch: run.head_branch,
    event: run.event,
    jobs: jobs.map(j => ({ 
      id: j.id,
      name: j.name, 
      conclusion: j.conclusion, 
      status: j.status,
      steps: j.steps.map(s => ({ name: s.name, conclusion: s.conclusion, status: s.status })),
      annotations: (annotations[j.id] || []).map(a => ({
        path: a.path,
        line: a.start_line,
        level: a.annotation_level,
        msg: a.message,
        title: a.title
      }))
    }))
  };

  const prompt = `
    Analyze a specific GitHub Actions Workflow Run for failures, flakes, or syntax issues.
    
    GOAL: Provide a deep technical audit of this specific run.
    
    RUN DATA (INCLUDING JOB ANNOTATIONS):
    ${JSON.stringify(runContext)}

    INSTRUCTIONS:
    1. If the run failed, explain exactly WHY. Look at the 'annotations' as they contain compiler/test error logs.
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

export const analyzePullRequests = async (prs: GithubPullRequest[]): Promise<PrHealthAnalysisResult> => {
  const client = getClient();
  const summary = prs.map(p => ({ number: p.number, title: p.title, bodySnippet: p.body?.substring(0, 200) }));
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Audit PR health: ${JSON.stringify(summary)}. Identify PRs with excessive code addition or AI-generated boilerplate (slop).`,
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
    
    ### ANTI-AI-SLOP DIRECTIVES (EXPLICIT SECTION REQUIRED IN OUTPUT)
    You MUST identify and flag the following:
    1. OVERLY VERBOSE COMMENTS: Flag comments that state the obvious or are generated by LLMs without adding value.
    2. OVER-ENGINEERING: Identify systems that are more complex than necessary for the requirement.
    3. DUPLICATE HOOKS/TYPES: Identify where the PR adds a new type or hook that likely exists or is very similar to existing features.
    4. CODE RATIO: If the PR adds > 100 lines, you MUST find at least 10 lines that can be removed. Prioritize deletion.
    5. STALE FEATURES: If this PR replaces a feature, verify that the OLD feature is being DELETED in the diff.
    
    GUIDELINES:
    1. FILE-BY-FILE ANALYSIS: Group your feedback by file. For every major issue, provide a "Problem" description and an "Implementation Sample" (Actual code snippet).
    2. ARCHITECTURAL IMPACT: How does this change affect the overall system? 
    3. BEST PRACTICES: Check for type safety (TypeScript), performance bottlenecks, and security vulnerabilities.
    4. GITHUB CHECKS: I will provide the status of the automated tests (checks). Correlate any failures with the code changes in the diff.
    
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
          reviewComment: { type: Type.STRING, description: "Comprehensive Markdown review with a mandatory 'Anti-AI-Slop' section." },
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
    contents: `
      Analyze intent for fresh restart: ${diff.substring(0, 40000)}.
      The plan MUST focus on MINIMALISM. 
      Identify every line of code in the current PR that is 'slop' (boilerplate, over-engineered, redundant) and explicitly plan to EXCLUDE it from the new version.
      Include a "Decommissioning Phase" to remove the old feature/code being replaced.
    `,
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


// End of file
