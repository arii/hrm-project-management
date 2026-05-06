
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, EnrichedPullRequest, CodeReviewResult, GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, WorkflowQualitativeResult, GithubAnnotation, PrHealthAnalysisResult, WorkflowAnalysis, ModelTier } from '../types';
import { storage } from './storageService';

/**
 * Clean a string that might contain Markdown JSON code blocks
 */
const cleanJsonString = (str: string): string => {
  return str.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
};

let globalGeminiApiKey: string | null = null;

export const setGeminiApiKey = (key: string) => {
  globalGeminiApiKey = key;
};

const getClient = () => {
  const settings = storage.getSettings();
  const apiKey = globalGeminiApiKey || settings.geminiApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please check your settings.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Retry helper for transient Google API errors (503 UNAVAILABLE)
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      // 503 is service unavailable, often transient
      // 429 is rate limit (quota)
      const isTransient = e.message?.includes('503') || e.message?.includes('UNAVAILABLE') || e.message?.includes('429');
      if (!isTransient || i === maxRetries) throw e;
      
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`[GeminiService] Transient error (attempt ${i + 1}/${maxRetries + 1}): ${e.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Ensures the user has selected a Pro API key if using a Pro model.
 * Non-blocking to avoid hangs in sandboxed environments.
 */
const ensureProApiKey = async () => {
  // @ts-ignore
  if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      // @ts-ignore
      window.aistudio.openSelectKey(); // Non-blocking
    }
  }
};

const PRO_MODEL = 'gemini-3.1-pro-preview';
const FLASH_MODEL = 'gemini-3-flash-preview';

const MODELS = {
  [ModelTier.LITE]: 'gemini-3.1-flash-lite-preview', // Cost-optimized, no thinking
  [ModelTier.FLASH]: FLASH_MODEL, // Balanced
  [ModelTier.PRO]: PRO_MODEL, // Thinking, Complex tasks
};

const getModelForTier = (tier?: ModelTier): string => {
  const selectedTier = tier || storage.getModelTier();
  return MODELS[selectedTier] || MODELS[ModelTier.FLASH];
};

/**
 * Helper to determine thinking level for a request.
 * Lite models do not support thinking level HIGH/LOW (effectively MINIMAL).
 */
const getThinkingConfig = (tier: ModelTier, options: { lowThinking?: boolean } = {}) => {
  if (tier === ModelTier.LITE) return undefined;
  if (tier === ModelTier.PRO) return undefined; // Pro usually manages its own thinking budget in 3.1
  
  return { 
    thinkingLevel: options.lowThinking ? ThinkingLevel.LOW : ThinkingLevel.HIGH 
  };
};

export const analyzeWorkflowBatch = async (
  repo: string,
  runs: any[],
  geminiKey?: string
): Promise<WorkflowAnalysis> => {
  const ai = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = getModelForTier(tier);
  
  const systemInstruction = `You are a DevOps Architect auditing GitHub Workflows for the repository "${repo}".
  Provide a comprehensive audit including a health score (0-100), a technical summary, and specific actionable findings.
  Output MUST be valid JSON.`;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: `Analyze these workflow runs: ${JSON.stringify(runs)}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      // @ts-ignore
      thinkingConfig: getThinkingConfig(tier, { lowThinking: true }),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          healthScore: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          technicalFindings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['failure', 'warning', 'info'] },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                location: { type: Type.STRING },
                remediation: { type: Type.STRING }
              },
              required: ['type', 'title', 'description']
            }
          },
          qualitativeAnalysis: {
            type: Type.OBJECT,
            properties: {
              efficacy: { type: Type.STRING },
              coverage: { type: Type.STRING },
              efficiency: { type: Type.STRING },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['efficacy', 'coverage', 'efficiency', 'recommendations']
          }
        },
        required: ['healthScore', 'summary', 'technicalFindings', 'qualitativeAnalysis']
      }
    }
  }));

  return JSON.parse(cleanJsonString(response.text || '{}'));
};

export const analyzeWorkflowHealth = async (
  run: GithubWorkflowRun, 
  jobs: GithubWorkflowJob[], 
  annotations: Record<number, GithubAnnotation[]> = {},
  workflowFile?: { path: string; ref: string; content: string } | null,
  tier: ModelTier = storage.getModelTier()
): Promise<WorkflowAnalysis> => {
  if (tier === ModelTier.PRO) await ensureProApiKey();
  const client = getClient();
  const model = getModelForTier(tier);
  
  const workflowSection = workflowFile
    ? `
## WORKFLOW DEFINITION (fetched at ref: \`${workflowFile.ref}\` — this is what GitHub actually executed)
File: \`${workflowFile.path}\`

\`\`\`yaml
${workflowFile.content}
\`\`\`

CRITICAL: Cross-reference the job names and step names in this YAML with the job/step names in the run data.
If a step name exists in the YAML but is marked as "skipped" in the run, explain why (conditional, needs, if: expressions).
If a job failed and the YAML shows a specific action version (e.g. actions/checkout@v2), flag outdated actions as a potential cause.
`
    : `## WORKFLOW DEFINITION
(Could not be fetched — the branch may have been force-pushed or deleted.
Reason may be the run is from a fork PR. Proceed with job/step data only.)
`;

  const jobsSection = jobs.map(j => ({
    id: j.id,
    name: j.name,
    conclusion: j.conclusion,
    status: j.status,
    durationSeconds: j.completed_at && j.started_at
      ? Math.round(
          (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000
        )
      : null,
    steps: j.steps.map(s => ({
      name: s.name,
      conclusion: s.conclusion,
      status: s.status,
      number: s.number
    })),
    annotations: (annotations[j.id] || []).map(a => ({
      level: a.annotation_level,
      title: a.title,
      message: a.message,
      path: a.path,
      line: a.start_line
    }))
  }));

  const prompt = `
You are a senior DevOps engineer and GitHub Actions specialist.
Perform a DEEP TECHNICAL AUDIT of this specific workflow run.

## RUN METADATA
- Run ID: ${run.id}
- Workflow: ${run.name}
- Event trigger: ${run.event}
- Branch: ${run.head_branch}
- Commit SHA: ${run.head_sha}
- Conclusion: ${run.conclusion}
- Status: ${run.status}

${workflowSection}

## JOB AND STEP DATA (with annotations / compiler errors)
${JSON.stringify(jobsSection, null, 2)}

## YOUR TASK

### 1. ROOT CAUSE ANALYSIS (required)
Identify the EXACT cause of failure. Be surgical:
- Which step failed and what error did it produce? (Use annotations.message if present)
- Is this a code error, a configuration error, or a transient infrastructure error?
- If annotations are empty, reason from step names and job conclusions alone.

### 2. WORKFLOW YAML CORRELATION (if YAML provided)
- Does the YAML use pinned action versions (e.g. @v3) or floating refs (@main)? Flag floating refs.
- Are there \`if:\` conditionals that could cause steps to skip unexpectedly?
- Does the trigger (on: push/pull_request/schedule) match the event that fired (\`${run.event}\`)? Flag mismatches.
- Does the YAML assume environment secrets or variables that may be missing?

### 3. FIX RECOMMENDATIONS (actionable, specific)
Provide concrete remediation steps. For each issue:
- State the EXACT change needed in the workflow YAML or the application code.
- Include a code snippet where applicable.
- Categorize as: YAML_FIX | DEPENDENCY_FIX | CODE_FIX | ENVIRONMENT_FIX | INFRASTRUCTURE_FLAKE

### 4. ISSUE QUALITY
For each finding, generate a GitHub issue title and body suitable for filing directly.
The body must include: observed behavior, root cause, exact fix steps, and (where applicable) the YAML snippet to change.

OUTPUT: Respond ONLY with the specified JSON schema. Do not add prose outside the JSON.
`;

  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          healthScore: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          technicalFindings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['failure', 'warning', 'info'] },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                location: { type: Type.STRING },
                remediation: { type: Type.STRING }
              },
              required: ['type', 'title', 'description']
            }
          },
          qualitativeAnalysis: {
            type: Type.OBJECT,
            properties: {
              efficacy: { type: Type.STRING },
              coverage: { type: Type.STRING },
              efficiency: { type: Type.STRING },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['efficacy', 'coverage', 'efficiency', 'recommendations']
          }
        },
        required: ['healthScore', 'summary', 'technicalFindings', 'qualitativeAnalysis']
      }
    }
  }));

  const text = response.text || "{}";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse workflow health JSON:", text);
    throw new Error("AI returned an invalid format for workflow health analysis.");
  }
};

export const analyzeWorkflowQualitative = async (
  workflows: Array<{ name: string, path: string, content: string }>,
  runs: GithubWorkflowRun[],
  repoContext: { fileList: string, readmeSnippet: string, packageJson: string },
  tier: ModelTier = storage.getModelTier()
): Promise<WorkflowQualitativeResult> => {
  if (tier === ModelTier.PRO) await ensureProApiKey();
  const client = getClient();
  const model = getModelForTier(tier);
  
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

  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: getThinkingConfig(tier),
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
  }));

  const text = response.text || "{}";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse qualitative analysis JSON:", text);
    throw new Error("AI returned an invalid format for qualitative workflow analysis.");
  }
};

export const analyzePullRequests = async (prs: GithubPullRequest[]): Promise<PrHealthAnalysisResult> => {
  const client = getClient();
  const summary = prs.map(p => ({ number: p.number, title: p.title, bodySnippet: p.body?.substring(0, 200) }));
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = getModelForTier(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
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
  }));
  
  const text = response.text || "{}";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse PR analysis JSON:", text);
    throw new Error("AI returned an invalid format for PR health analysis.");
  }
};

/**
 * COMPREHENSIVE CODE REVIEW ENGINE
 */

export const generateCodeReview = async (
  pr: EnrichedPullRequest, 
  diff: string, 
  options: { modelTier?: ModelTier, lowThinking?: boolean } = {}
): Promise<CodeReviewResult> => {
  const userTier = storage.getModelTier();
  const tier = options.modelTier || userTier;
  const modelName = getModelForTier(tier);

  if (tier === ModelTier.PRO) await ensureProApiKey();
  const client = getClient();
  
  const checksSummary = pr.checkResults?.map(c => `- ${c.name}: ${c.status} (${c.conclusion || 'Pending'})`).join('\n') || "No checks found.";

  const systemInstruction = `You are a Principal Software Engineer and Technical Architect performing a DEEP Technical Audit.
    
    ### ANTI-AI-SLOP DIRECTIVES
    Flag: Verbose comments, over-engineering, duplicate patterns, and slop.
    Audit ratio: If additions > 100 lines, find 10+ lines to remove.
    
    ### MANDATORY SECTIONS
    1. ## ANTI-AI-SLOP
    2. ## FINAL RECOMMENDATION (Approved | Approved with Minor Changes | Not Approved)
    
    Return valid JSON matching the specified schema.`;

  const prompt = `Perform Code Review for PR #${pr.number} - "${pr.title}".
    
    Description: ${pr.body || "No description provided."}
    Checks: ${checksSummary}
    
    Diff: ${diff.substring(0, 45000)}`;

  // Wrap in a timeout promise
  const maxTimeout = tier === ModelTier.PRO ? 180000 : 60000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`AI Analysis timed out after ${maxTimeout/1000}s. Pro models may take longer to think.`)), maxTimeout);
  });

  const generatePromise = withRetry(async () => {
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        // @ts-ignore
        thinkingConfig: getThinkingConfig(tier, { lowThinking: options.lowThinking }),
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reviewComment: { type: Type.STRING, description: "Comprehensive Markdown review with a mandatory 'Anti-AI-Slop' section and a 'FINAL RECOMMENDATION' section." },
            labels: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendation: { type: Type.STRING, enum: ['Approved', 'Approved with Minor Changes', 'Not Approved'] },
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
          required: ['reviewComment', 'labels', 'recommendation']
        }
      }
    });

    return JSON.parse(cleanJsonString(response.text || '{}'));
  });

  try {
    return await Promise.race([generatePromise, timeoutPromise]);
  } catch (e: any) {
    if (e.message.includes("timed out")) throw e;
    console.error("[GeminiService] Failed to parse code review JSON:", e);
    throw new Error("AI returned an invalid format for the code review.");
  }
};


export const extractIssuesFromComments = async (comments: Array<{ id: number, user: string, body: string, url: string }>): Promise<ProposedIssue[]> => {
  const client = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = getModelForTier(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: `
      Extract follow-up issues from these comments: ${JSON.stringify(comments)}.
      Each issue's 'body' MUST be a full implementation plan including any code suggestions mentioned in the comments.
    `,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: getThinkingConfig(tier, { lowThinking: true }),
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
  }));
  
  const text = response.text || "[]";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse issues from comments JSON:", text);
    throw new Error("AI returned an invalid format for extracted issues.");
  }
};


export const analyzePrForRestart = async (pr: EnrichedPullRequest, diff: string, tier: ModelTier = storage.getModelTier()): Promise<{ plan: string; title: string }> => {
  if (tier === ModelTier.PRO) await ensureProApiKey();
  const client = getClient();
  const model = getModelForTier(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: `
      Analyze intent for fresh restart: ${diff.substring(0, 40000)}.
      The plan MUST focus on MINIMALISM. 
      Identify every line of code in the current PR that is 'slop' (boilerplate, over-engineered, redundant) and explicitly plan to EXCLUDE it from the new version.
      Include a "Decommissioning Phase" to remove the old feature/code being replaced.
    `,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: getThinkingConfig(tier),
      responseSchema: {
        type: Type.OBJECT,
        properties: { plan: { type: Type.STRING }, title: { type: Type.STRING } },
        required: ['plan', 'title']
      }
    }
  }));

  const text = response.text || "{}";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse restart plan JSON:", text);
    throw new Error("AI returned an invalid format for the restart plan. Please try again.");
  }
};


export const analyzePrForSync = async (pr: EnrichedPullRequest, diff: string): Promise<{ syncIssues: string[] }> => {
  const client = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = getModelForTier(tier);
  const prompt = `
    Analyze PR #${pr.number} for synchronization and conflict resolution issues.
    
    GOAL: Identify specific areas where the feature branch '${pr.head.ref}' has diverged from '${pr.base.ref}' in a way that creates "git noise", "phantom changes", or complex conflicts that standard 'update branch' tools cannot handle.
    
    ### TARGET AREAS:
    1. MERGE CONFLICTS: Identify files likely to have conflicts. Pay special attention to large data files, lockfiles, or configuration files.
    2. PHANTOM CHANGES: Identify lines that appear as changes but are already in the base branch (stale feature branch). BE EXTREMELY CAREFUL: Do not misidentify new feature code as phantom changes. Only flag code that is literally a duplicate of what is already in the base branch.
    3. CI SYNC & SNAPSHOT ISSUES: Identify test failures or snapshot mismatches (e.g., Jest snapshots, visual regression images) caused by base branch updates. These often require surgical reconciliation rather than a simple overwrite.
    4. REBASE DISCREPANCIES: Identify where the branch structure is misaligned or where commits have been duplicated.
    
    PR CONTEXT:
    Title: ${pr.title}
    Diff: ${diff.substring(0, 40000)}
    
    OUTPUT: A JSON object with a list of specific 'syncIssues' found.
  `;

  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: getThinkingConfig(tier, { lowThinking: true }),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          syncIssues: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['syncIssues']
      }
    }
  }));

  const text = response.text || "{}";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse sync analysis JSON:", text);
    throw new Error("AI returned an invalid format for sync analysis.");
  }
};


export const parseIssuesFromText = async (text: string): Promise<ProposedIssue[]> => {
  const client = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = getModelForTier(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: `Extract tasks from this text: ${text}. Ensure bodies are comprehensive and contain all technical details and code found in the source.`,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: getThinkingConfig(tier, { lowThinking: true }),
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
  }));
  
  const responseText = response.text || "[]";
  try {
    return JSON.parse(cleanJsonString(responseText));
  } catch (e) {
    console.error("[GeminiService] Failed to parse issues from text JSON:", responseText);
    throw new Error("AI returned an invalid format for parsed issues.");
  }
};

// End of file
