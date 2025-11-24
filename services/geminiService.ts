
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, PrActionRecommendation, LinkSuggestion, CleanupAnalysisResult, RedundancyAnalysisResult, TriageAnalysisResult } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

// Analyze Issues for Redundancies (Structured)
export const analyzeIssueRedundancy = async (issues: GithubIssue[]): Promise<RedundancyAnalysisResult> => {
  const client = getClient();
  
  // Prepare data for the prompt (minimized to save tokens)
  const issueSummary = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 300) : "No description", // Truncate body
    labels: i.labels.map(l => l.name).join(", "),
  }));

  const prompt = `
    You are a senior project manager analyzing a GitHub repository.
    I have a list of open issues.
    
    Your goal is to identify:
    1. Duplicate issues that can be closed.
    2. Groups of related issues (e.g. fragments of a larger feature) that should be consolidated into a SINGLE new "Master Issue" or "Epic".
    
    Output a structured JSON response with:
    - 'summary': A markdown executive summary of the redundancy state.
    - 'redundantIssues': A list of issue numbers to CLOSE because they are duplicates or stale.
    - 'consolidatedIssues': A list of NEW issues to CREATE that replace/consolidate existing ones.
    
    Issues Data:
    ${JSON.stringify(issueSummary)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          redundantIssues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                issueNumber: { type: Type.INTEGER },
                reason: { type: Type.STRING }
              },
              required: ['issueNumber', 'reason']
            }
          },
          consolidatedIssues: {
             type: Type.ARRAY,
             items: {
               type: Type.OBJECT,
               properties: {
                 title: { type: Type.STRING },
                 body: { type: Type.STRING },
                 labels: { type: Type.ARRAY, items: { type: Type.STRING } },
                 reason: { type: Type.STRING },
                 replacesIssueNumbers: { type: Type.ARRAY, items: { type: Type.INTEGER } }
               },
               required: ['title', 'body', 'labels', 'reason', 'replacesIssueNumbers']
             }
          }
        },
        required: ['summary', 'redundantIssues', 'consolidatedIssues']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as RedundancyAnalysisResult;
};

// Identify Redundant Candidates (Structured for Auto-Select)
export const identifyRedundantCandidates = async (issues: GithubIssue[]): Promise<number[]> => {
  const client = getClient();
  
  const issueSummary = issues.map(i => ({
    id: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 100) : "", 
  }));

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      Analyze these issues and identify ones that are likely duplicates or can be safely closed.
      If Issue A and Issue B are duplicates, keep the one with more detail or lower ID open, and mark the other for closure.
      Return ONLY a JSON array of issue numbers (integers) that should be CLOSED.
      
      Issues: ${JSON.stringify(issueSummary)}
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as number[];
};

// Analyze PRs for Health and Mergeability
export const analyzePullRequests = async (prs: GithubPullRequest[]): Promise<string> => {
  const client = getClient();

  const prSummary = prs.map(p => ({
    number: p.number,
    title: p.title,
    author: p.user.login,
    branch: p.head.ref,
    created: p.created_at,
    draft: p.draft,
    body: p.body ? p.body.substring(0, 200) : "No description",
  }));

  const prompt = `
    You are a Lead DevOps Engineer. Analyze these Pull Requests.
    
    Focus on:
    1. Identifying "Stale" PRs (old, no recent activity).
    2. Identifying "Redundant" branches (e.g., multiple PRs fixing the same thing).
    3. Assessing PR quality based on descriptions (vague vs detailed).
    4. Determine if any PRs seem to overlap in purpose.

    Provide a concise Markdown executive summary. Use tables if helpful.
    Highlight PRs that need immediate attention.

    PR Data:
    ${JSON.stringify(prSummary)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  return response.text || "No analysis generated.";
};

// Cleanup Report: Match Closed PRs to Open Issues
export const generateCleanupReport = async (openIssues: GithubIssue[], closedPrs: GithubPullRequest[]): Promise<CleanupAnalysisResult> => {
  const client = getClient();

  // We only need recently closed PRs to check against current open issues
  const recentClosedPrs = closedPrs.slice(0, 30).map(p => ({
    number: p.number,
    title: p.title,
    merged_at: p.merged_at,
    body: p.body ? p.body.substring(0, 300) : "",
  }));

  const currentOpenIssues = openIssues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 100) : "",
  }));

  const prompt = `
    You are a GitHub Repository Maintainer.
    
    I have a list of OPEN Issues and a list of recently CLOSED/MERGED Pull Requests.
    
    Your task:
    Determine if any of the OPEN issues should likely be closed because they were addressed by the CLOSED Pull Requests.
    Look for keywords like "fixes", "resolves", "closes" in the PR body, or semantic similarity between the PR title and Issue title.

    Generate a structured response:
    1. 'report': A markdown executive summary of your findings.
    2. 'actions': A list of specific actions to take.
       - If you are confident an issue is fixed, suggest 'close'.
       - If you suspect it's fixed but need verification, suggest 'comment' with a question asking if it's resolved.
    
    Open Issues:
    ${JSON.stringify(currentOpenIssues)}

    Recently Closed PRs:
    ${JSON.stringify(recentClosedPrs)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: {
             type: Type.STRING,
             description: "The full markdown analysis report."
          },
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                issueNumber: { type: Type.INTEGER },
                action: { type: Type.STRING, enum: ['close', 'comment'] },
                reason: { type: Type.STRING },
                prReference: { type: Type.INTEGER, nullable: true },
                commentBody: { type: Type.STRING, description: "Text to post on the issue." },
                confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
              },
              required: ['issueNumber', 'action', 'reason', 'confidence']
            }
          }
        },
        required: ['report', 'actions']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as CleanupAnalysisResult;
};

// Generate Triage Report (Structured)
export const generateTriageReport = async (issues: GithubIssue[]): Promise<TriageAnalysisResult> => {
  const client = getClient();

  const issueData = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 150) : "",
    labels: i.labels.map(l => l.name),
    created_at: i.created_at
  }));

  const prompt = `
    Create a prioritized Triage Report for the engineering team based on these open issues.
    
    Analyze each issue to determine:
    1. Priority (High, Medium, Low) - check for urgent keywords.
    2. Effort (Small, Medium, Large) - estimate based on complexity.
    3. Category (Bug, Feature, Refactor, Documentation, Chore).
    
    OUTPUT JSON:
    - 'report': A professional Markdown roadmap document.
    - 'actions': A list of issues that need label updates.
      - 'suggestedLabels': MUST include labels for Priority (e.g. 'priority:high'), Type (e.g. 'type:bug'), and Effort (e.g. 'effort:small'). Do not include labels that already exist on the issue.
      
    Issues:
    ${JSON.stringify(issueData)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING },
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                issueNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                suggestedLabels: { type: Type.ARRAY, items: { type: Type.STRING } },
                reason: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
                category: { type: Type.STRING }
              },
              required: ['issueNumber', 'title', 'suggestedLabels', 'reason', 'priority', 'effort', 'category']
            }
          }
        },
        required: ['report', 'actions']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as TriageAnalysisResult;
};

// --- AGENT FEATURES ---

// 1. Suggest New Strategic Issues
export const suggestStrategicIssues = async (
  issues: GithubIssue[], 
  prs: GithubPullRequest[], 
  mode: string,
  userGuidance?: string
): Promise<ProposedIssue[]> => {
  const client = getClient();
  const context = {
    issues: issues.slice(0, 30).map(i => i.title),
    prs: prs.slice(0, 20).map(p => p.title),
  };

  let specificPrompt = "";
  switch (mode) {
    case 'strategic':
      specificPrompt = "Identify high-level gaps in features, documentation, or major testing coverage. Suggest 3 high-value strategic issues that advance the project significantly.";
      break;
    case 'tech_debt':
      specificPrompt = "Focus on general code quality, maintainability, and reliability.";
      break;
    case 'quick_win':
      specificPrompt = "Focus on 'Quick Wins' or 'Good First Issues'. Suggest very small, actionable, low-effort tasks like UI polish, typo fixes, README updates, or simple configuration tweaks.";
      break;
    case 'code_reuse':
      specificPrompt = "Identify opportunities for code reuse. Look for likely duplicated logic inferred from feature sets and suggest creating shared utilities or components.";
      break;
    case 'dead_code':
      specificPrompt = "Identify potential dead code or deprecated features that should be removed to improve maintainability.";
      break;
    case 'readability':
      specificPrompt = "Focus on function/file naming and readability. Suggest renaming or restructuring for better clarity and developer experience.";
      break;
    case 'maintainability':
      specificPrompt = "Focus on updating dependencies, replacing unsupported packages with modern tools, or improving CI/CD pipelines.";
      break;
    default:
      specificPrompt = "Suggest improvements based on best practices.";
  }

  if (userGuidance) {
    specificPrompt += `\n\nUSER GUIDANCE (Prioritize this): "${userGuidance}"`;
  }

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      Based on the current list of issues and pull requests, suggest new issues to create.
      
      CRITICAL: Do NOT suggest issues that are duplicates of the existing "Issues" list provided in the context.
      
      FOCUS: ${specificPrompt}
      
      Context: ${JSON.stringify(context)}
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            body: { type: Type.STRING },
            reason: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'], description: "Estimated effort to complete the task" },
            labels: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'body', 'reason', 'priority', 'effort', 'labels']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as ProposedIssue[];
};

// 2. Audit Pull Requests (Actions)
export const auditPullRequests = async (prs: GithubPullRequest[]): Promise<PrActionRecommendation[]> => {
  const client = getClient();
  
  const prData = prs.map(p => ({
    number: p.number,
    title: p.title,
    created: p.created_at,
    draft: p.draft,
    user: p.user.login
  }));

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      Review these open PRs. 
      Recommend actions:
      - 'close' if it looks like a test, stale (> 30 days), or duplicate.
      - 'prioritize' if it looks important or quick to win.
      - 'comment' if it needs a gentle nudge.
      
      PRs: ${JSON.stringify(prData)}
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            prNumber: { type: Type.INTEGER },
            action: { type: Type.STRING, enum: ['close', 'prioritize', 'comment'] },
            reason: { type: Type.STRING },
            suggestedComment: { type: Type.STRING }
          },
          required: ['prNumber', 'action', 'reason']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as PrActionRecommendation[];
};

// 3. Find Issue Links
export const findIssuePrLinks = async (issues: GithubIssue[], prs: GithubPullRequest[]): Promise<LinkSuggestion[]> => {
  const client = getClient();
  
  const issueData = issues.map(i => ({ id: i.number, title: i.title }));
  const prData = prs.map(p => ({ id: p.number, title: p.title }));

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      Match these open PRs to these open Issues based on semantic similarity of their titles.
      Only return matches where you are confident the PR is addressing the Issue.
      
      Issues: ${JSON.stringify(issueData)}
      PRs: ${JSON.stringify(prData)}
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            prNumber: { type: Type.INTEGER },
            issueNumber: { type: Type.INTEGER },
            confidence: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ['prNumber', 'issueNumber', 'confidence', 'reason']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as LinkSuggestion[];
};

// 4. Generate Repo Briefing (Dashboard)
export const generateRepoBriefing = async (
  stats: any, 
  velocity: { opened: number, closed: number }, 
  recentActivity: GithubIssue[], 
  stalePrs: GithubPullRequest[]
): Promise<string> => {
  const client = getClient();
  
  const activitySummary = recentActivity.slice(0, 10).map(i => `[${i.state}] ${i.title}`);
  
  const context = {
    totalOpenIssues: stats.openIssuesCount,
    totalOpenPRs: stats.openPRsCount,
    velocity: velocity,
    stalePRCount: stalePrs.length,
    recentActivity: activitySummary
  };

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      You are a CTO giving a "Morning Briefing" on the repository status.
      Analyze the stats and recent activity.
      
      Write a short, professional, 3-sentence summary that highlights:
      1. The team's momentum (velocity).
      2. Any immediate blockers (stale PRs or high open issue count).
      3. A recommended focus for the day.
      
      Stats: ${JSON.stringify(context)}
    `,
  });

  return response.text || "Repo is stable. No major anomalies detected.";
};
