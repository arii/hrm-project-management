
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, PrActionRecommendation, LinkSuggestion, CleanupAnalysisResult, RedundancyAnalysisResult, TriageAnalysisResult, BranchCleanupResult, JulesSession, JulesAgentAction, EnrichedPullRequest, PrHealthAnalysisResult, MergeProposal, JulesCleanupResult } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

// Analyze Issues for Redundancies (Structured)
export const analyzeIssueRedundancy = async (issues: GithubIssue[]): Promise<RedundancyAnalysisResult> => {
  if (!issues || issues.length === 0) {
    return { summary: "No issues to analyze.", redundantIssues: [], consolidatedIssues: [] };
  }
  const client = getClient();
  
  // Prepare data for the prompt (minimized to save tokens)
  const issueSummary = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 300) : "No description", // Truncate body
    labels: i.labels.map(l => l.name).join(", "),
  }));

  const prompt = `
    You are a Technical Lead optimizing a backlog for AI Agents (Autonomous Coders).
    I have a list of open issues.
    
    Your goal is to optimize the backlog by identifying:
    1. Exact Duplicates: Issues that are identical in intent to another.
    2. Consolidation Candidates: Very small, tightly coupled tasks that should be merged into a SINGLE atomic task.
    
    CRITICAL CONSTRAINT FOR CONSOLIDATION:
    - DO NOT consolidate complex or unrelated features into "Epics". 
    - AI Agents fail when tasks are too large. 
    - Only consolidate if the resulting task is still small, specific, and completable in a single coding session (< 20 files changed).
    - If issues are distinct features, keep them separate.
    
    Output a structured JSON response with:
    - 'summary': A markdown executive summary of the redundancy state.
    - 'redundantIssues': A list of issue numbers to CLOSE because they are exact duplicates or superseded.
    - 'consolidatedIssues': A list of NEW issues to CREATE.
    
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
  if (!issues || issues.length === 0) return [];
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

// Analyze PRs for Health and Mergeability (Structured)
export const analyzePullRequests = async (prs: GithubPullRequest[]): Promise<PrHealthAnalysisResult> => {
  if (!prs || prs.length === 0) {
    return { report: "No Pull Requests to analyze.", actions: [] };
  }
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
    
    1. Identify "Stale" PRs (old, no recent activity).
    2. Identify "Redundant" branches (e.g., multiple PRs fixing the same thing).
    3. Assess PR quality.
    
    OUTPUT JSON:
    - 'report': A markdown executive summary of the PR health state.
    - 'actions': Specific, actionable recommendations.
      - Suggest 'close' for stale/abandoned PRs.
      - Suggest 'comment' to nudge reviewers or ask for updates.
      - Suggest 'label' to tag PRs (e.g., 'stale', 'needs-review').
      
    PR Data:
    ${JSON.stringify(prSummary)}
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
                prNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                action: { type: Type.STRING, enum: ['close', 'comment', 'label'] },
                label: { type: Type.STRING, nullable: true },
                reason: { type: Type.STRING },
                suggestedComment: { type: Type.STRING, nullable: true },
                confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
              },
              required: ['prNumber', 'title', 'action', 'reason', 'confidence']
            }
          }
        },
        required: ['report', 'actions']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as PrHealthAnalysisResult;
};

// Cleanup Report: Match Closed PRs to Open Issues
export const generateCleanupReport = async (openIssues: GithubIssue[], closedPrs: GithubPullRequest[]): Promise<CleanupAnalysisResult> => {
  if (!openIssues || openIssues.length === 0 || !closedPrs || closedPrs.length === 0) {
    return { report: "Insufficient data for cleanup analysis.", actions: [] };
  }
  const client = getClient();

  // STRICTLY FILTER for MERGED PRs only. 
  // A closed PR that wasn't merged (merged_at is null) didn't fix anything.
  const mergedPrs = closedPrs.filter(p => p.merged_at !== null);

  if (mergedPrs.length === 0) {
    return { report: "No recently merged PRs found to check against issues.", actions: [] };
  }

  // We only need recently merged PRs to check against current open issues
  const recentMergedPrs = mergedPrs.slice(0, 30).map(p => ({
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
    
    I have a list of OPEN Issues and a list of recently MERGED Pull Requests.
    
    Your task:
    Determine if any of the OPEN issues should likely be closed because they were addressed by the MERGED Pull Requests.
    Look for keywords like "fixes", "resolves", "closes" in the PR body, or semantic similarity between the PR title and Issue title.

    Generate a structured response:
    1. 'report': A markdown executive summary of the findings.
    2. 'actions': A list of specific actions to take.
       - If you are confident an issue is fixed, suggest 'close'.
       - If you suspect it's fixed but need verification, suggest 'comment' with a question asking if it's resolved.
    
    Open Issues:
    ${JSON.stringify(currentOpenIssues)}

    Recently Merged PRs:
    ${JSON.stringify(recentMergedPrs)}
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

// Branch Cleanup Analysis
export const analyzeBranchCleanup = async (branches: string[], mergedPrs: { ref: string, number: number }[]): Promise<BranchCleanupResult> => {
  if (!branches || branches.length === 0) {
    return { report: "No branches found to analyze.", candidates: [] };
  }
  const client = getClient();
  
  const context = {
    branches,
    mergedPrs
  };

  const prompt = `
    You are a Git Repository Janitor.
    
    I have a list of remote branches and a list of recently merged PRs (including their branch names).
    
    Your task:
    1. Identify "Zombie" branches: Branches that still exist but match the head ref of a MERGED PR. These are safe to delete.
    2. Identify "Stale" branches: Branches that look like temporary feature branches (e.g., 'patch-1', 'temp/fix') but are not in the list of protected branches (leader, main, master, dev, staging).
    3. Be careful NOT to recommend deleting core branches like 'leader', 'main', 'master', 'develop', 'release'.
    
    Ensure the "report" is pure Markdown without any JSON escaping artifacts (e.g., use real line breaks, not \\n).

    Generate a structured response:
    - 'report': A markdown summary of branch hygiene.
    - 'candidates': A list of branches to delete.

    Data:
    ${JSON.stringify(context)}
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
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                branchName: { type: Type.STRING },
                reason: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['merged', 'stale', 'abandoned'] },
                confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
              },
              required: ['branchName', 'reason', 'type', 'confidence']
            }
          }
        },
        required: ['report', 'candidates']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as BranchCleanupResult;
};

// Jules Session Cleanup Analysis
export const analyzeJulesCleanup = async (sessions: JulesSession[], closedPrs: GithubPullRequest[]): Promise<JulesCleanupResult> => {
  if (!sessions || sessions.length === 0) {
    return { report: "No Jules sessions to analyze.", candidates: [] };
  }
  const client = getClient();

  // Create lookup for closed PRs (merged or closed)
  const closedPrSet = new Set(closedPrs.map(p => p.number));
  
  // Format sessions for analysis
  const sessionData = sessions.map(s => {
    const prUrl = s.outputs?.find(o => o.pullRequest)?.pullRequest?.url;
    let prNumber: number | null = null;
    if (prUrl) {
      const match = prUrl.match(/pull\/(\d+)/);
      if (match) prNumber = parseInt(match[1]);
    }
    
    return {
      name: s.name,
      title: s.title,
      state: s.state,
      createTime: s.createTime,
      linkedPr: prNumber,
      isLinkedPrClosed: prNumber ? closedPrSet.has(prNumber) : false
    };
  });

  const prompt = `
    You are a Housekeeping Bot for Jules Sessions.
    
    Your task: Identify sessions that are candidates for deletion (cleanup).
    
    Criteria for deletion:
    1. **Merged/Closed PR**: The session created a PR that has since been MERGED or CLOSED. The work is done or abandoned.
    2. **Stale & Failed**: The session is > 7 days old and ended in a FAILED/TERMINATED state.
    3. **Stale & No PR**: The session is > 7 days old, SUCCEEDED, but has no linked PR and hasn't been touched.
    
    OUTPUT JSON:
    - 'report': A markdown summary of the cleanup analysis.
    - 'candidates': List of session names to delete.

    Session Data:
    ${JSON.stringify(sessionData)}
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
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sessionName: { type: Type.STRING },
                reason: { type: Type.STRING },
                linkedPrNumber: { type: Type.INTEGER, nullable: true },
                status: { type: Type.STRING, enum: ['merged', 'closed', 'stale', 'failed'] }
              },
              required: ['sessionName', 'reason', 'status']
            }
          }
        },
        required: ['report', 'candidates']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as JulesCleanupResult;
};

// Generate Triage Report (Structured)
export const generateTriageReport = async (issues: GithubIssue[]): Promise<TriageAnalysisResult> => {
  if (!issues || issues.length === 0) {
    return { report: "No open issues to triage.", actions: [] };
  }
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
  
  // Use a larger context to prevent duplicates.
  const context = {
    existingIssueTitles: issues.map(i => i.title),
    existingPrTitles: prs.map(p => p.title),
  };

  let specificPrompt = "";
  switch (mode) {
    case 'strategic':
      specificPrompt = "Identify MISSING features required for a complete product. Do NOT suggest broad improvements. Suggest specific, implementable features (e.g. 'Add Refresh Button to Dashboard' not 'Improve Dashboard UI').";
      break;
    case 'tech_debt':
      specificPrompt = "Identify specific code quality tasks. Target specific file/folder refactors (e.g. 'Extract auth logic from App.tsx to separate service') rather than general 'Refactor Code' tasks.";
      break;
    case 'quick_win':
      specificPrompt = "Suggest atomic, trivial tasks (e.g., 'Fix typo in README', 'Update dependency X', 'Add loading spinner to button'). Max 1-hour effort.";
      break;
    case 'code_reuse':
      specificPrompt = "Identify duplicated logic that can be extracted into a shared utility function. Name the specific logic and the proposed utility name.";
      break;
    case 'dead_code':
      specificPrompt = "Identify potential dead code or unused files that can be safely deleted. Be specific about which files.";
      break;
    case 'readability':
      specificPrompt = "Suggest renaming specific complex functions or splitting large files. Naming must be the focus.";
      break;
    case 'maintainability':
      specificPrompt = "Suggest specific tooling configs (e.g. 'Add Prettier config', 'Update GitHub Action to Node 20').";
      break;
    default:
      specificPrompt = "Suggest atomic improvements.";
  }

  if (userGuidance) {
    specificPrompt += `\n\nUSER GUIDANCE (Prioritize this): "${userGuidance}"`;
  }

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `
      You are an Architect creating work orders for an AI Agent (Autonomous Coder).
      
      Your goal: Generate SMALL, HIGHLY SPECIFIC issues.
      
      RULES FOR AI AGENT SUCCESS:
      1. ATOMICITY: Each issue must be solvable in a single coding session (< 20 files touched).
      2. SPECIFICITY: Do not be vague. Mention specific components, files, or logic paths if possible.
      3. DE-DUPLICATION: Do NOT suggest issues that already exist in "existingIssueTitles".
      
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
  if (!prs || prs.length === 0) return [];
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
      
      IMPORTANT:
      1. If recommending 'comment', prefix the comment body with "@jules".
      2. If recommending 'prioritize', explicitly check (or mention checking) for merge conflicts and build/test errors in your reasoning or suggested comment.
      
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
  if (!issues || issues.length === 0 || !prs || prs.length === 0) return [];
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

// 4. Analyze Jules Sessions (Operator)
export const analyzeJulesSessions = async (sessions: JulesSession[], prs: EnrichedPullRequest[]): Promise<JulesAgentAction[]> => {
  if (!sessions || sessions.length === 0) return [];
  const client = getClient();
  
  // Create a map of PR URL -> PR Details for lookup
  const prMap = new Map(prs.map(p => [p.html_url, p]));

  const sessionData = sessions.map(s => {
    const prUrl = s.outputs?.find(o => o.pullRequest)?.pullRequest?.url;
    let prContext = "No PR linked";
    let hasConflicts = false;
    let prMerged = false;

    if (prUrl) {
      const pr = prMap.get(prUrl);
      if (pr) {
        prContext = `Linked PR #${pr.number} is ${pr.state.toUpperCase()}.`;
        if (pr.mergeable === false) {
           hasConflicts = true;
           prContext += " HAS MERGE CONFLICTS.";
        } else if (pr.merged_at) {
           prMerged = true;
           prContext += " MERGED.";
        }
      } else {
        // If we don't have PR data (maybe it's closed/merged and not in the 'open' list we fetched, or we fetched limited list)
        // We assume it exists if URL exists.
        prContext = "PR exists but status unknown (likely closed/merged if not in open list).";
      }
    }

    return {
      name: s.name,
      title: s.title,
      state: s.state,
      createTime: s.createTime,
      prContext: prContext,
      hasConflicts: hasConflicts,
      prMerged: prMerged,
      lastStatus: s.state 
    };
  });

  const prompt = `
    You are an AI Operator for autonomous coding sessions.
    Analyze these sessions and suggest ONE action per session if necessary.
    
    Session Data provided includes: State, Title, Creation Time, and Linked PR Context.

    Rules for Recommendations:
    1. **Recover**: If session 'hasConflicts' is true, OR state is FAILED/TERMINATED. Suggest a rebase command.
    2. **Start Over**: If session is FAILED/TERMINATED and appears urgent/important (e.g. "Critical", "Fix", "Blocker" in title), OR if 'hasConflicts' is true but session is FAILED. Suggest 'start_over' to delete and retry.
    3. **Delete**: If session's linked PR is 'prMerged' (true). This is a cleanup action.
    4. **Delete**: If session is very old (> 7 days) and FAILED/STALE with no active PR.
    5. **Publish**: If session SUCCEEDED and "No PR linked".
    6. **Message**: If session is SUCCEEDED or AWAITING_USER_FEEDBACK but PR is OPEN (not merged). Do NOT suggest generic nudges. Suggest a verification message.
       - Recommended Command Text: "Please git fetch, rebase off origin/leader, and ensure the following pass: npm run lint, npm run build, npm test, npm run test:all, npm run dev, and ./start_production.sh"
    7. **Message**: If session is RUNNING > 24h.

    Return a list of actionable items.

    Sessions: ${JSON.stringify(sessionData)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            sessionName: { type: Type.STRING },
            action: { type: Type.STRING, enum: ['delete', 'recover', 'publish', 'message', 'start_over'] },
            reason: { type: Type.STRING },
            suggestedCommand: { type: Type.STRING }
          },
          required: ['sessionName', 'action', 'reason']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as JulesAgentAction[];
};

// 5. Suggest Mergeable Branches (Integrator)
export const suggestMergeableBranches = async (prs: EnrichedPullRequest[]): Promise<MergeProposal[]> => {
  if (!prs || prs.length === 0) return [];
  
  // Filter for viable candidates FIRST to save tokens and improve quality
  const candidates = prs.filter(pr => 
    pr.mergeable === true &&  // No Conflicts
    !pr.draft &&              // Not Draft
    (pr.testStatus === 'passed' || pr.testStatus === 'unknown') // Tests passed or skipped (not failed)
  ).map(pr => ({
    number: pr.number,
    title: pr.title,
    branch: pr.head.ref,
    base: pr.base.ref,
    files: pr.changed_files
  }));

  if (candidates.length === 0) return [];

  const client = getClient();
  const prompt = `
    You are a Release Manager.
    Review these mergeable Pull Requests.
    
    Group them into logical "Merge Batches" to be dispatched to an autonomous agent for merging.
    Example groups: "Dependency Updates", "UI Fixes", "Core Refactors", "Documentation".
    
    If a PR is standalone or critical, it can be its own group.
    Target branch for all is origin/leader unless specified otherwise.
    
    Candidates: ${JSON.stringify(candidates)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            groupName: { type: Type.STRING },
            prNumbers: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            branches: { type: Type.ARRAY, items: { type: Type.STRING } },
            reason: { type: Type.STRING },
            risk: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
            targetBranch: { type: Type.STRING }
          },
          required: ['groupName', 'prNumbers', 'branches', 'reason', 'risk', 'targetBranch']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as MergeProposal[];
};

// 6. Generate Repo Briefing (Dashboard)
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
