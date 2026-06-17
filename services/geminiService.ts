
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, EnrichedPullRequest, CodeReviewResult, GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, WorkflowQualitativeResult, GithubAnnotation, PrHealthAnalysisResult, WorkflowAnalysis, ModelTier } from '../types';
import { storage, StorageKeys } from './storageService';
import { cleanJsonString, withRetry } from './aiUtils';

let globalGeminiApiKey: string | null = null;
let cachedModelsList: GeminiModelInfo[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

const DEPRECATED_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking'
];

const isModelDeprecated = (name: string): boolean => {
  const norm = name.toLowerCase().replace('models/', '');
  // Exclude explicitly deprecated models
  if (DEPRECATED_MODELS.some(dep => norm === dep || norm.startsWith(dep + '-'))) {
    return true;
  }
  // Exclude legacy 1.0 models
  if (norm.includes('gemini-1.0')) {
    return true;
  }
  // Exclude old preview versions of 1.x / 2.x models
  if (norm.includes('-preview') && !norm.includes('gemini-3')) {
    return true;
  }
  return false;
};

const PRO_MODEL = 'gemini-3.1-pro-preview';
const FLASH_MODEL = 'gemini-3.5-flash';
const LITE_MODEL = 'gemini-3.1-flash-lite';

const recordUsage = (result: any, tier?: ModelTier) => {
  try {
    const tokens = result?.response?.usageMetadata?.totalTokenCount || result?.usageMetadata?.totalTokenCount;
    if (tokens) {
      storage.trackUsage(tokens, tier);
    }
  } catch (e) {
    console.warn("[GeminiService] Failed to record usage:", e);
  }
};

const MODELS = {
  [ModelTier.LITE]: LITE_MODEL, 
  [ModelTier.FLASH]: FLASH_MODEL,
  [ModelTier.PRO]: PRO_MODEL,
};

/**
 * Dynamically resolves the best matching model name from the active API token.
 * Hierarchy: Manual Call Argument > Global Pinned Model > Tier-based Auto Selection.
 */
export const resolveAvailableModel = async (tier: ModelTier, manualModel?: string): Promise<string> => {
  const settings = storage.getSettings();
  
  // 1. Specific model requested by caller
  if (manualModel && manualModel !== 'auto') {
    return manualModel;
  }

  // 2. Global pinned model override
  if (settings.geminiModelOverride && settings.geminiModelOverride !== 'auto') {
    return settings.geminiModelOverride;
  }

  try {
    // Use the cached detailed list instead of making a fresh models.list() call every time
    const allModels = await listAvailableModelsDetailed();
    
    // Load cached model health to skip models known to be restricted
    const cachedHealth = storage.getRaw<Record<string, { status: string }>>(StorageKeys.MODEL_HEALTH, {});
    
    // Strict filtering: Include only stable, core reasoning models
    // Exclude 'nano' (underpowered), 'tuning' (internal), 'experiment' (unstable), and stale 1.0 or preview versions
    const validModels = allModels.filter(m => {
      const name = m.name.toLowerCase();
      if (!name.startsWith('gemini-')) return false; // Ensure it's a Gemini core model
      if (name.includes('vision') || name.includes('learnlm')) return false;
      
      const isDeprecated = isModelDeprecated(name);
      const isUnderpowered = name.includes('nano') || name.includes('8b');
      const isInternal = name.includes('tuning') || name.includes('experiment') || name.includes('alpha');
      
      // Exclude models known to be restricted
      const isRestricted = cachedHealth[m.name]?.status === 'restricted';
      
      return !isUnderpowered && !isInternal && !isRestricted && !isDeprecated;
    });
    const validNames = validModels.map(m => m.name);
    
    if (validNames.length > 0) {
      const requestedDefault = MODELS[tier];
      
      // If our chosen default is present in the list, return it safely
      if (validNames.includes(requestedDefault)) {
        return requestedDefault;
      }
      
      // Smart matching based on tier characteristics
      if (tier === ModelTier.PRO) {
        const proMatch = validNames.find(n => n.toLowerCase().includes('3.1-pro') || n.toLowerCase().includes('pro'));
        if (proMatch) return proMatch;
      } else if (tier === ModelTier.FLASH) {
        const flashMatch = validNames.find(n => (n.toLowerCase().includes('3.5-flash') || n.toLowerCase().includes('flash')) && !n.toLowerCase().includes('lite'));
        if (flashMatch) return flashMatch;
      } else if (tier === ModelTier.LITE) {
        const liteMatch = validNames.find(n => n.toLowerCase().includes('lite') || n.toLowerCase().includes('3.1-flash-lite'));
        if (liteMatch) return liteMatch;
      }

      // Fallback: use first valid model if requested defaults are unavailable
      return validNames[0];
    }
  } catch (error) {
    console.warn("[GeminiService] Model resolution failed. Using local defaults.", error);
  }
  
  return MODELS[tier] || FLASH_MODEL;
};

/**
 * Fetches detailed information about all models supported by the current API key.
 */
export interface GeminiModelInfo {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedActions: string[];
}

export const listAvailableModelsDetailed = async (forceRefresh = false): Promise<GeminiModelInfo[]> => {
  if (!forceRefresh && cachedModelsList && (Date.now() - lastCacheTime < CACHE_TTL)) {
    return cachedModelsList;
  }

  try {
    const ai = getClient();
    const availableModels = await ai.models.list();
    const models: GeminiModelInfo[] = [];
    const excludedKeywords = ['-tts', 'robotics', 'antigravity', 'deep-research', 'computer-use', 'embedding', 'aqa'];

    for await (const m of availableModels) {
      const name = m.name.toLowerCase();
      const isSpecialist = excludedKeywords.some(keyword => name.includes(keyword));
      
      if (!name.startsWith('models/gemini-')) continue; // Must be a core Gemini model
      if (name.includes('vision') || name.includes('learnlm')) continue;

      // Filter out old/stale/unsupported 1.0 models and preview versions
      const isDeprecated = isModelDeprecated(name);
      const isUnderpowered = name.includes('nano') || name.includes('8b');
      const isInternal = name.includes('tuning') || name.includes('experiment') || name.includes('alpha');

      if (m.supportedActions?.includes("generateContent") && !isSpecialist && !isUnderpowered && !isInternal && !isDeprecated) {
        models.push({
          name: m.name.replace('models/', ''),
          displayName: m.displayName || m.name,
          description: m.description || "",
          inputTokenLimit: m.inputTokenLimit || 0,
          outputTokenLimit: m.outputTokenLimit || 0,
          supportedActions: m.supportedActions
        });
      }
    }
    
    cachedModelsList = models;
    lastCacheTime = Date.now();
    return models;
  } catch (error) {
    console.error("[GeminiService] Failed to list models:", error);
    throw error;
  }
};

export const registerModelFailure = (modelName: string, errorMessage: string) => {
  if (!modelName) return;
  const lowerMsg = errorMessage.toLowerCase();
  const isQuotaOrRestriction = 
    lowerMsg.includes("429") || 
    lowerMsg.includes("resource_exhausted") || 
    lowerMsg.includes("quota") ||
    lowerMsg.includes("limit: 0") ||
    lowerMsg.includes("limit is 0") ||
    lowerMsg.includes("billing") ||
    lowerMsg.includes("not enabled") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("access restricted") ||
    lowerMsg.includes("permission denied") ||
    lowerMsg.includes("unsupported") ||
    lowerMsg.includes("blocked") ||
    lowerMsg.includes("restricted");

  if (isQuotaOrRestriction) {
    try {
      const cachedHealth = storage.getRaw<Record<string, any>>(StorageKeys.MODEL_HEALTH, {});
      cachedHealth[modelName] = {
        name: modelName,
        status: 'restricted',
        lastError: errorMessage.substring(0, 150)
      };
      storage.set(StorageKeys.MODEL_HEALTH, cachedHealth);
      console.log(`[GeminiService] Automatically registered ${modelName} as restricted due to: ${errorMessage}`);
    } catch (e) {
      console.warn("[GeminiService] Failed to update health cache:", e);
    }
  }
};

export const testModelConnectivity = async (modelName: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const ai = getClient();
    // Tiny request to test connectivity and quota using standard models.generateContent from @google/genai
    const response = await withRetry(() => ai.models.generateContent({
      model: modelName,
      contents: "ping"
    }), 1, 500, 'Gemini-Ping');
    recordUsage(response, storage.getModelTier());
    return { success: true };
  } catch (e: any) {
    const errorMessage = typeof e === 'object' && e !== null ? (e.message || JSON.stringify(e)) : String(e);
    // Automatically register as restricted if it matches restriction keywords
    registerModelFailure(modelName, errorMessage);
    return { success: false, error: errorMessage };
  }
};

/**
 * Helper to determine thinking level for a request.
 * Disabling thinking configuration to avoid 400 ApiErrors on unsupported models.
 */
const getThinkingConfig = (tier: ModelTier, options: { lowThinking?: boolean } = {}) => {
  return undefined;
};

export const analyzeWorkflowBatch = async (
  repo: string,
  runs: any[],
  geminiKey?: string
): Promise<WorkflowAnalysis> => {
  const ai = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = await resolveAvailableModel(tier);
  
  const systemInstruction = `You are a DevOps Architect auditing GitHub Workflows for the repository "${repo}".
  Provide a comprehensive audit including a health score (0-100), a technical summary, and specific actionable findings.
  
  ### REPAIR DIRECTIVES (for remediation)
  - DO NOT include diffs.
  - Provide ONLY specific, actionable instructions to fix the issue.
  - Instructions must be imperative and direct (e.g., "Change line X to Y", "Update regex in Z").
  - Instructions MUST include: "Verify tests", "Run audit for anti-patterns", and "Update snapshots if necessary".
  - Instructions MUST NOT request a plan or ask follow-up questions. They are final execution orders.

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
  }), 3, 1000, 'GeminiService');
  recordUsage(response, tier);

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
  const model = await resolveAvailableModel(tier);
  
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
- DO NOT include diffs.
- Provide ONLY specific, actionable instructions to fix the issue.
- Instructions must be imperative and direct (e.g., "Change line X to Y", "Update regex in Z").
- Instructions MUST include: "Verify tests", "Run audit for anti-patterns", and "Update snapshots if necessary".
- Instructions MUST NOT request a plan or ask follow-up questions. They are final execution orders.
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
  }), 3, 1000, 'GeminiService');
  recordUsage(response);

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
  const model = await resolveAvailableModel(tier);
  
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
  }), 3, 1000, 'GeminiService');
  recordUsage(response);

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
  const model = await resolveAvailableModel(tier);
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
  }), 3, 1000, 'GeminiService');
  recordUsage(response, tier);
  
  const responseText = response.text || "{}";
  try {
    const data = JSON.parse(cleanJsonString(responseText));
    return {
      report: data.report || "",
      actions: data.actions || [],
      modelUsed: model
    };
  } catch (e) {
    console.error("[GeminiService] Failed to parse PR analysis JSON:", responseText);
    return {
      report: "Analysis failed due to format error.",
      actions: [],
      modelUsed: model
    };
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
  const modelName = await resolveAvailableModel(tier);

  if (tier === ModelTier.PRO) await ensureProApiKey();
  const client = getClient();
  
  const checksSummary = pr.checkResults?.map(c => `- ${c.name}: ${c.status} (${c.conclusion || 'Pending'})`).join('\n') || "No checks found.";

  const systemInstruction = `You are a Principal Software Engineer and Technical Architect performing a DEEP Technical Audit.
    
    ### ANTI-AI-SLOP DIRECTIVES
    Flag: Verbose comments, over-engineering, duplicate patterns, and slop.
    Audit ratio: If additions > 100 lines, find 10+ lines to remove.

    ### REPAIR DIRECTIVES (for suggestedIssues)
    - DO NOT include diffs.
    - Provide ONLY specific, actionable instructions to fix the issue.
    - Instructions must be imperative and direct (e.g., "Change line X to Y", "Update regex in Z").
    - Instructions MUST include: "Verify tests", "Run audit for anti-patterns", and "Update snapshots if necessary".
    - Instructions MUST NOT request a plan or ask follow-up questions. They are final execution orders.
    
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
    recordUsage(response, tier);

    const text = response.text || "{}";
    
    // Check if the response is actually an error object before parsing as code review
    if (text.includes('"status":403') || text.includes('"status":401')) {
      throw new Error(`AI API Error: ${text}`);
    }

    const parsed = JSON.parse(cleanJsonString(text));
    return {
      ...parsed,
      modelUsed: modelName
    };
  }, 3, 1000, 'GeminiService-Review');

  try {
    return await Promise.race([generatePromise, timeoutPromise]);
  } catch (e: any) {
    if (e.message?.includes("timed out")) throw e;
    
    // Check if the error is related to quota, API key limits, or billing issues
    const errorMessage = typeof e === 'object' && e !== null ? (e.message || JSON.stringify(e)) : String(e);
    const isQuotaOrApiKey = errorMessage.includes("429") || 
                            errorMessage.includes("RESOURCE_EXHAUSTED") || 
                            errorMessage.includes("quota") ||
                            errorMessage.includes("API_KEY_INVALID") ||
                            errorMessage.includes("billing") ||
                            errorMessage.includes("API key");

    if (isQuotaOrApiKey) {
      throw new Error(`Gemini API Error (Quota/Rate Limit): The configured API key has exceeded its quota or has billing restrictions. Please check your plan & billing details on Google AI Studio (https://aistudio.google.com/). Detail: ${errorMessage.substring(0, 300)}`);
    }

    console.error("[GeminiService] Failed to parse code review JSON:", e);
    throw new Error("AI returned an invalid format for the code review.");
  }
};


export const extractIssuesFromComments = async (comments: Array<{ id: number, user: string, body: string, url: string }>): Promise<ProposedIssue[]> => {
  const client = getClient();
  const tier = storage.getModelTier() || ModelTier.LITE;
  const model = await resolveAvailableModel(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: `
      Extract follow-up issues from these comments: ${JSON.stringify(comments)}.
      
      ### FOLLOW-UP ISSUE DIRECTIVES:
      - Each issue's 'body' MUST be a full implementation specification including any code suggestions mentioned in the comments.
      - DO NOT include diffs.
      - Provide ONLY specific, actionable instructions to fix the issue.
      - Instructions must be imperative and direct (e.g., "Change line X to Y", "Update regex in Z").
      - Instructions MUST include: "Verify tests", "Run audit for anti-patterns", and "Update snapshots if necessary".
      - Instructions MUST NOT request a plan or ask follow-up questions. They are final execution orders.
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
  }), 3, 1000, 'GeminiService-Comments');
  recordUsage(response, tier);
  
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
  const model = await resolveAvailableModel(tier);
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
  }), 3, 1000, 'GeminiService-Restart');
  recordUsage(response, tier);

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
  const model = await resolveAvailableModel(tier);
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
  }), 3, 1000, 'GeminiService-Sync');
  recordUsage(response, tier);

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
  const model = await resolveAvailableModel(tier);
  const response = await withRetry(() => client.models.generateContent({
    model,
    contents: `Extract tasks from this text: ${text}. 
    
    ### TASK EXTRACTION DIRECTIVES:
    - Ensure bodies are comprehensive and contain all technical details and code found in the source.
    - DO NOT include diffs.
    - Provide ONLY specific, actionable instructions to fix the issue.
    - Instructions must be imperative and direct (e.g., "Change line X to Y", "Update regex in Z").
    - Instructions MUST include: "Verify tests", "Run audit for anti-patterns", and "Update snapshots if necessary".
    - Instructions MUST NOT request a plan or ask follow-up questions. They are final execution orders.`,
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
  }), 3, 1000, 'GeminiService-TaskExtract');
  recordUsage(response, tier);
  
  const responseText = response.text || "[]";
  try {
    return JSON.parse(cleanJsonString(responseText));
  } catch (e) {
    console.error("[GeminiService] Failed to parse issues from text JSON:", responseText);
    throw new Error("AI returned an invalid format for parsed issues.");
  }
};

// End of file
