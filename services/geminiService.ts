
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, EnrichedPullRequest, CodeReviewResult, GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, WorkflowQualitativeResult, GithubAnnotation, PrHealthAnalysisResult, WorkflowAnalysis } from '../types';

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
  const apiKey = globalGeminiApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please check your settings.");
  }
  return new GoogleGenAI({ apiKey });
};

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

export const analyzeWorkflowBatch = async (
  repo: string,
  runs: any[],
  geminiKey?: string
): Promise<WorkflowAnalysis> => {
  const apiKey = geminiKey || globalGeminiApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `Analyze the following GitHub Workflow execution data for the repository "${repo}".
  Provide a comprehensive audit including a health score (0-100), a technical summary, specific findings, and a qualitative analysis of efficacy, coverage, and efficiency.
  
  Data: ${JSON.stringify(runs)}
  
  Return the analysis in JSON format:
  {
    "healthScore": number,
    "summary": "string",
    "technicalFindings": [
      { "type": "failure" | "warning" | "info", "title": "string", "description": "string", "location": "string", "remediation": "string" }
    ],
    "qualitativeAnalysis": {
      "efficacy": "string",
      "coverage": "string",
      "efficiency": "string",
      "recommendations": ["string"]
    }
  }`;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
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
  });

  return JSON.parse(cleanJsonString(response.text));
};

export const analyzeWorkflowHealth = async (
  run: GithubWorkflowRun, 
  jobs: GithubWorkflowJob[], 
  annotations: Record<number, GithubAnnotation[]> = {},
  workflowFile?: { path: string; ref: string; content: string } | null
): Promise<WorkflowAnalysis> => {
  const client = getClient();
  
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

  const response = await client.models.generateContent({
    model: PRO_MODEL,
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
  });

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
  repoContext: { fileList: string, readmeSnippet: string, packageJson: string }
): Promise<WorkflowQualitativeResult> => {
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
    model: PRO_MODEL,
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
  const response = await client.models.generateContent({
    model: FLASH_MODEL,
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
  options: { useFlash?: boolean, lowThinking?: boolean } = {}
): Promise<CodeReviewResult> => {
  const client = getClient();
  const model = options.useFlash ? FLASH_MODEL : PRO_MODEL;
  
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

  // Wrap in a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("AI Analysis timed out after 60s. The PR diff might be too complex or the service is busy.")), 60000);
  });

  const generatePromise = (async () => {
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: options.lowThinking ? { thinkingLevel: ThinkingLevel.LOW } : undefined,
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

    const text = response.text || "{}";
    return JSON.parse(cleanJsonString(text));
  })();

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
  const response = await client.models.generateContent({
    model: FLASH_MODEL,
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
  
  const text = response.text || "[]";
  try {
    return JSON.parse(cleanJsonString(text));
  } catch (e) {
    console.error("[GeminiService] Failed to parse issues from comments JSON:", text);
    throw new Error("AI returned an invalid format for extracted issues.");
  }
};


export const analyzePrForRestart = async (pr: EnrichedPullRequest, diff: string): Promise<{ plan: string; title: string }> => {
  const client = getClient();
  const response = await client.models.generateContent({
    model: PRO_MODEL,
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
  const prompt = `
    Analyze PR #${pr.number} for synchronization and conflict resolution issues.
    
    GOAL: Identify specific areas where the feature branch '${pr.head.ref}' has diverged from '${pr.base.ref}' in a way that creates "git noise", "phantom changes", or complex conflicts that standard 'update branch' tools cannot handle.
    
    ### TARGET AREAS:
    1. MERGE CONFLICTS: Identify files likely to have conflicts. Pay special attention to large data files, lockfiles, or configuration files.
    2. PHANTOM CHANGES: Identify lines that appear as changes but are actually already in the base branch (stale feature branch). BE EXTREMELY CAREFUL: Do not misidentify new feature code as phantom changes. Only flag code that is literally a duplicate of what is already in the base branch.
    3. CI SYNC & SNAPSHOT ISSUES: Identify test failures or snapshot mismatches (e.g., Jest snapshots, visual regression images) caused by base branch updates. These often require surgical reconciliation rather than a simple overwrite.
    4. REBASE DISCREPANCIES: Identify where the branch structure is misaligned or where commits have been duplicated.
    
    PR CONTEXT:
    Title: ${pr.title}
    Diff: ${diff.substring(0, 40000)}
    
    OUTPUT: A JSON object with a list of specific 'syncIssues' found.
  `;

  const response = await client.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          syncIssues: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['syncIssues']
      }
    }
  });

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
  const response = await client.models.generateContent({
    model: FLASH_MODEL,
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
  
  const responseText = response.text || "[]";
  try {
    return JSON.parse(cleanJsonString(responseText));
  } catch (e) {
    console.error("[GeminiService] Failed to parse issues from text JSON:", responseText);
    throw new Error("AI returned an invalid format for parsed issues.");
  }
};


// End of file
