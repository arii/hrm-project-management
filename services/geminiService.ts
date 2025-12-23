
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, GithubPullRequest, ProposedIssue, PrActionRecommendation, LinkSuggestion, CleanupAnalysisResult, RedundancyAnalysisResult, TriageAnalysisResult, BranchCleanupResult, JulesSession, JulesAgentAction, EnrichedPullRequest, PrHealthAnalysisResult, MergeProposal, JulesCleanupResult, ArchitectAnalysisResult, CodeReviewResult, QualityAnalysisResult, RecoveryAnalysisResult, RepoStats } from '../types';
import { fetchRepoContent } from './githubService';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

// --- AI Batch Creator Parser ---
export const parseIssuesFromText = async (text: string): Promise<ProposedIssue[]> => {
  if (!text || text.trim().length === 0) return [];
  const client = getClient();

  const prompt = `
    Role: Senior Technical Project Manager.
    Task: Parse the following unstructured text, notes, or documentation into a set of distinct, high-quality GitHub Issues.
    
    Guidelines:
    1. **De-duplication**: If the text describes the same task multiple times, consolidate it.
    2. **Granularity**: Break large features into actionable sub-tasks (each roughly 1-4 hours of work).
    3. **Actionability**: Every issue MUST have a clear title and a detailed Markdown body with "Acceptance Criteria".
    4. **Metadata**: Assign realistic Priority (High/Medium/Low) and Effort (Small/Medium/Large).
    
    Input Text:
    """
    ${text}
    """
    
    Output a strict JSON array of objects.
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Concise, action-oriented title' },
            body: { type: Type.STRING, description: 'Detailed Markdown description with context and requirements' },
            priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
            labels: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Relevant category labels like bug, feature, refactor' }
          },
          required: ['title', 'body', 'priority', 'effort', 'labels']
        }
      }
    }
  });

  try {
    const parsed = JSON.parse(response.text || "[]");
    return parsed as ProposedIssue[];
  } catch (e) {
    console.error("Failed to parse Gemini response for issue extraction", e);
    return [];
  }
};

// Analyze Issues for Redundancies (Structured)
export const analyzeIssueRedundancy = async (issues: GithubIssue[]): Promise<RedundancyAnalysisResult> => {
// ... rest of file remains the same ...
  if (!issues || issues.length === 0) {
    return { summary: "No issues to analyze.", redundantIssues: [], consolidatedIssues: [] };
  }
  const client = getClient();
  
  // Prepare data for the prompt (Increased context window to 500 chars for better semantic matching)
  const issueSummary = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 500) : "No description", 
    labels: i.labels.map(l => l.name).join(", "),
  }));

  const prompt = `
    You are a Technical Lead optimizing a backlog for AI Agents (Autonomous Coders).
    I have a list of open issues.
    
    Your goal is to optimize the backlog by identifying:
    1. **Semantic Duplicates**: Issues that have different wording but identical intent (e.g. "Fix Login" vs "Login Broken").
    2. **Micro-Task Consolidation**: Identify clusters of very small tasks affecting the same component or area.
       - *Example*: "Update button color", "Change button font", "Fix button margin".
       - *Action*: Consolidate into "Refactor Button Component Styles".
    
    CRITICAL CONSTRAINT FOR CONSOLIDATION:
    - AI Agents fail when tasks are too large. 
    - Only consolidate if the resulting task is still specific and completable in a single coding session.
    - However, DO consolidate if individual tasks are too trivial (< 5 mins) to stand alone.
    
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
    body: i.body ? i.body.substring(0, 150) : "", 
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
export const generateCleanupReport = async (
  openIssues: GithubIssue[], 
  closedPrs: GithubPullRequest[],
  julesSessions: JulesSession[] = [] // Ignored for closing logic to ensure code merge verification
): Promise<CleanupAnalysisResult> => {
  if ((!openIssues || openIssues.length === 0)) {
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
  const recentMergedPrs = mergedPrs.slice(0, 50).map(p => ({
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
    
    I have a list of OPEN Issues and recently MERGED Pull Requests.
    
    Your task:
    Determine if any of the OPEN issues should likely be closed because they were addressed by the MERGED Pull Requests.
    
    CRITICAL RULE:
    - Only recommend closing an issue if a MERGED Pull Request explicitly fixes it (referenced in body or title) or is semantically identical.
    - Do NOT recommend closing an issue based on Jules Sessions or unmerged PRs. Changes must be merged.
    
    Look for:
    1. Keywords like "fixes", "resolves", "closes" in PR bodies.
    2. Semantic similarity between PR titles and Issue titles.

    Generate a structured response:
    1. 'report': A markdown executive summary of the findings.
    2. 'actions': A list of specific actions to take.
       - If you are confident an issue is fixed by a MERGED PR, suggest 'close'.
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
                sessionReference: { type: Type.STRING, nullable: true, description: "Name of the Jules session if relevant" },
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
    4. **Archived**: The session is > 30 days old (archived).
    
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

// Analyze Issue Quality (Improve/Close)
export const analyzeIssueQuality = async (
  issues: GithubIssue[], 
  repoName?: string, 
  token?: string
): Promise<QualityAnalysisResult> => {
  if (!issues || issues.length === 0) {
    return { summary: "No issues to analyze.", improvements: [], closures: [] };
  }
  const client = getClient();

  // --- Context Gathering ---
  let contextPrompt = "";
  
  if (repoName && token) {
    try {
      // 1. Try to fetch official templates (Fetch up to 3 to be comprehensive)
      const templates = await fetchRepoContent(repoName, '.github/ISSUE_TEMPLATE', token);
      if (Array.isArray(templates) && templates.length > 0) {
        // Fetch up to 3 .md files
        const mdFiles = templates.filter((t: any) => t.name.endsWith('.md')).slice(0, 3);
        
        for (const file of mdFiles) {
           const content = await fetchRepoContent(repoName, `.github/ISSUE_TEMPLATE/${file.name}`, token);
           if (typeof content === 'string') {
             contextPrompt += `\n\n### Official Template (${file.name}):\n${content.substring(0, 1000)}\n...`;
           }
        }
      }

      // 2. Try to fetch audit guides (Fetch up to 3)
      const auditDocs = await fetchRepoContent(repoName, 'docs/audits', token);
      if (Array.isArray(auditDocs) && auditDocs.length > 0) {
         const guideFiles = auditDocs.filter((t: any) => t.name.endsWith('.md')).slice(0, 3);
         
         for (const file of guideFiles) {
            const guideContent = await fetchRepoContent(repoName, `docs/audits/${file.name}`, token);
            if (typeof guideContent === 'string') {
               contextPrompt += `\n\n### Repository Audit Guide (${file.name}):\n${guideContent.substring(0, 1000)}\n...`;
            }
         }
      }
    } catch (e) {
      // Fail silently on context fetching, fall back to generic standards
      console.warn("Could not fetch repo context:", e);
    }
  }

  const issueData = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body ? i.body.substring(0, 300) : "", // Truncate
    created_at: i.created_at
  }));

  const prompt = `
    You are a Staff Software Engineer and Technical Project Manager.
    Your goal is to ensure every issue in the backlog is a **High-Quality, Actionable Engineering Task**.

    ${contextPrompt}

    **CRITICAL INSTRUCTION: WORKLOAD EXPANSION & 30-MINUTE MINIMUM**
    - AI Agents and Junior Engineers struggle with "one-liners" or trivial tasks.
    - **Minimum Workload**: Every issue MUST represent at least **30 minutes** of focused work.
    - **Action**: If an issue is simple (e.g., "Fix typo"), you MUST EXPAND it.
      - Add: "Grep codebase for similar occurrences", "Verify no regression in related areas", "Update snapshots", "Add a test case".
      - Turn "Update button color" into "Refactor Button Component Styles, verify hover/focus states, and check accessibility."

    **Goal 1: Expand & Refine (Vague Issues)**
    - Identify issues that are too vague, short, or lack clear acceptance criteria.
    - REWRITE the description to be comprehensive.
    - Structure:
      1. **Context & Motivation**: Why are we doing this?
      2. **Implementation Details**: Specific files, components, or logic paths to check.
      3. **Definition of Done**: Bulleted list of requirements including testing and docs.
      4. **Verification**: How to verify the fix manually and automated.

    **Goal 2: Prune (Stale/Irrelevant Issues)**
    - Identify issues that are clearly obsolete, exact duplicates, or "test" noise.

    **Output JSON:**
    {
      "summary": "Markdown summary of quality check",
      "improvements": [
        { "issueNumber": 123, "title": "Old Title", "suggestedTitle": "New Title", "suggestedBody": "New Markdown Body...", "reason": "Original was too vague; expanded scope to meet 30m workload." }
      ],
      "closures": [
        { "issueNumber": 456, "title": "Old Title", "reason": "Seems like a test issue" }
      ]
    }

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
          summary: { type: Type.STRING },
          improvements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                issueNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                suggestedTitle: { type: Type.STRING },
                suggestedBody: { type: Type.STRING },
                reason: { type: Type.STRING }
              },
              required: ['issueNumber', 'title', 'suggestedTitle', 'suggestedBody', 'reason']
            }
          },
          closures: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                issueNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                reason: { type: Type.STRING }
              },
              required: ['issueNumber', 'title', 'reason']
            }
          }
        },
        required: ['summary', 'improvements', 'closures']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as QualityAnalysisResult;
};

// 7. Generate Code Review (Modified: Focus on technical analysis AND identify separate follow-ups)
export const generateCodeReview = async (pr: EnrichedPullRequest, diff: string): Promise<CodeReviewResult> => {
  const client = getClient();
  
  // Truncate diff if extremely large to prevent context overflow (saving token space)
  const maxDiffLength = 50000;
  const truncatedDiff = diff.length > maxDiffLength ? diff.substring(0, maxDiffLength) + "\n...[DIFF TRUNCATED]" : diff;

  const prompt = `
    **Role:** You are a Principal Software Engineer conducting a cohesive, comprehensive code review.
    
    **Task:** Review the provided diff strictly for technical quality and identify scoped follow-up work.
    
    **Context:**
    - **PR Title:** ${pr.title}
    - **Author:** ${pr.user.login}
    - **Description:** ${pr.body || "No description."}
    
    **Review Guidelines:**
    1. **Technical Excellence**: Spot logic errors, performance bottlenecks, or security flaws.
    2. **Follow-up Identification**: Identify changes that are technically sound but conceptually separate from this PR's core intent (Scope Creep).
    
    **Output Format (JSON):**
    {
      "reviewComment": "Markdown formatted review. Structure with: \n\n### 🚀 Executive Summary\n[Overall assessment]\n\n### 📂 File-by-File Audit\n- **filename.ext**: [Specific feedback]\n...\n\n### 🛠️ Key Recommendations\n[Bullet points]",
      "labels": ["size-label", "status-label"],
      "suggestedIssues": [
        {
          "title": "Short title",
          "body": "Markdown description",
          "reason": "Why this should be separate from current PR",
          "priority": "High|Medium|Low",
          "effort": "Small|Medium|Large",
          "labels": ["follow-up", "refactor"]
        }
      ]
    }
    
    **Valid Labels:**
    - Size: 'small', 'medium', 'large', 'xl'
    - Status: 'needs-improvement', 'ready-for-approval'

    **Diff:**
    ${truncatedDiff}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reviewComment: { type: Type.STRING },
          labels: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedIssues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                body: { type: Type.STRING },
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
  return JSON.parse(text) as CodeReviewResult;
};

// 8. Generate Recovery Plan
export const generateRecoveryPlan = async (pr: EnrichedPullRequest): Promise<RecoveryAnalysisResult> => {
  const client = getClient();
  
  const context = {
    title: pr.title,
    body: pr.body,
    state: pr.state,
    branch: pr.head.ref,
    base: pr.base.ref,
    changed_files: pr.changed_files,
    comments_count: pr.comments,
    test_status: pr.testStatus,
    mergeable: pr.mergeable
  };

  const prompt = `
    You are a Senior Engineering Manager deciding how to save a failing Pull Request.
    The PR in question is stuck, has conflicts, or has received too many comments/requests for changes.
    
    **Goal:** Determine if we should attempt to fix the existing branch (REPAIR) or start fresh (REWRITE).
    
    **Criteria:**
    - **REWRITE:** If the PR is very old, has massive merge conflicts, or seems fundamentally flawed (e.g. "XY Problem").
    - **REPAIR:** If the PR is mostly good but needs specific fixes (test failures, linting, small logic errors).
    
    **Instructions:**
    1. Select a recommendation.
    2. Write a prompt for "Jules" (our autonomous coding agent) to execute this plan.
       - If REPAIR: The prompt should tell Jules to checkout the branch '${pr.head.ref}', run tests, and fix issues.
       - If REWRITE: The prompt should tell Jules to checkout '${pr.base.ref}', and re-implement the feature described in '${pr.title}'.
    
    **PR Context:**
    ${JSON.stringify(context)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.2, // Low temp for decision making
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendation: { type: Type.STRING, enum: ['REPAIR', 'REWRITE'] },
          reason: { type: Type.STRING },
          julesPrompt: { type: Type.STRING }
        },
        required: ['recommendation', 'reason', 'julesPrompt']
      }
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text) as RecoveryAnalysisResult;
};

// 9. Generate Repo Briefing
export const generateRepoBriefing = async (
  stats: RepoStats, 
  velocity: { opened: number, closed: number }, 
  recentIssues: GithubIssue[], 
  recentPrs: GithubPullRequest[]
): Promise<string> => {
  const client = getClient();
  
  const context = {
    stats,
    velocity,
    recentIssues: recentIssues.map(i => i.title),
    recentPrs: recentPrs.map(p => p.title)
  };

  const prompt = `
    You are an AI Repository Manager. Generate a concise "Daily Briefing" for the engineering team.
    
    Data:
    ${JSON.stringify(context)}
    
    Format:
    - Markdown.
    - Start with a "Health Score" (A, B, C) based on open issues vs closed velocity.
    - Highlight 3 key areas of focus based on recent activity.
    - Be professional but encouraging.
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  return response.text || "No briefing generated.";
};

// 10. Architect: Suggest Strategic Issues
export const suggestStrategicIssues = async (
  issues: GithubIssue[], 
  prs: GithubPullRequest[], 
  mode: string, 
  guidance: string
): Promise<ArchitectAnalysisResult> => {
  const client = getClient();

  const prompt = `
    Role: Software Architect.
    Goal: Suggest new work items (Issues) to improve the repository.
    Mode: ${mode} (${guidance})
    
    Current State:
    - ${issues.length} Open Issues (Sample: ${issues.slice(0, 5).map(i => i.title).join(', ')})
    - ${prs.length} Open PRs
    
    Task:
    1. Identify gaps based on the 'Mode'.
    2. Propose 3-5 high-value issues to create.
    3. Suggest a "Pivot" if the current mode seems wrong (e.g. if too many bugs, suggest switching to "Stability").
    
    Output JSON:
    {
      "issues": [{ "title": "...", "body": "...", "priority": "High", "effort": "Medium", "labels": ["tech-debt"], "reason": "..." }],
      "suggestedPivot": { "mode": "stability", "guidance": "Focus on bug fixes", "reason": "Too many open bugs" }
    }
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
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
                body: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
                labels: { type: Type.ARRAY, items: { type: Type.STRING } },
                reason: { type: Type.STRING }
              },
              required: ['title', 'body', 'priority', 'effort', 'labels', 'reason']
            }
          },
          suggestedPivot: {
            type: Type.OBJECT,
            properties: {
              mode: { type: Type.STRING },
              guidance: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            nullable: true
          }
        },
        required: ['issues']
      }
    }
  });

  const text = response.text || "{\"issues\": []}";
  return JSON.parse(text) as ArchitectAnalysisResult;
};

// 11. Overseer: Audit Pull Requests (Action Oriented)
export const auditPullRequests = async (prs: GithubPullRequest[]): Promise<PrActionRecommendation[]> => {
  if (!prs || prs.length === 0) return [];
  const client = getClient();
  
  const prData = prs.map(p => ({
    number: p.number,
    title: p.title,
    user: p.user.login,
    draft: p.draft,
    created_at: p.created_at
  }));

  const prompt = `
    Role: Engineering Manager.
    Task: Review these PRs and assign actions.
    
    Actions:
    - 'prioritize': If it looks critical or is blocking.
    - 'close': If it looks abandoned (> 30 days old) or spam.
    - 'comment': If it needs a nudge (e.g. "Status update?").
    - 'publish': If it is a draft but looks ready (e.g. old draft).
    
    Output JSON array of recommendations.
    
    PRs:
    ${JSON.stringify(prData)}
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
            prNumber: { type: Type.INTEGER },
            action: { type: Type.STRING, enum: ['close', 'prioritize', 'comment', 'publish'] },
            reason: { type: Type.STRING },
            suggestedComment: { type: Type.STRING, nullable: true }
          },
          required: ['prNumber', 'action', 'reason']
        }
      }
    }
  });
  
  const text = response.text || "[]";
  return JSON.parse(text) as PrActionRecommendation[];
};

// 12. Janitor: Find Issue/PR Links
export const findIssuePrLinks = async (issues: GithubIssue[], prs: GithubPullRequest[]): Promise<LinkSuggestion[]> => {
  if (!issues.length || !prs.length) return [];
  const client = getClient();
  
  const issueData = issues.map(i => ({ id: i.number, title: i.title, state: i.state }));
  const prData = prs.map(p => ({ id: p.number, title: p.title, state: p.state }));

  const prompt = `
    Role: Project Linker.
    Task: Identify semantic links between Issues and PRs that are NOT explicitly linked yet.
    
    Match based on:
    - Similar titles (e.g. Issue "Fix Login" matches PR "Fixes login bug")
    - Keywords.
    
    Output JSON array of suggestions.
    
    Issues: ${JSON.stringify(issueData)}
    PRs: ${JSON.stringify(prData)}
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
            prNumber: { type: Type.INTEGER },
            issueNumber: { type: Type.INTEGER },
            confidence: { type: Type.STRING },
            reason: { type: Type.STRING },
            prTitle: { type: Type.STRING },
            prState: { type: Type.STRING },
            issueTitle: { type: Type.STRING },
            issueState: { type: Type.STRING }
          },
          required: ['prNumber', 'issueNumber', 'confidence', 'reason']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as LinkSuggestion[];
};

// 13. Operator: Analyze Jules Sessions
export const analyzeJulesSessions = async (sessions: JulesSession[], prs: EnrichedPullRequest[]): Promise<JulesAgentAction[]> => {
  if (!sessions.length) return [];
  const client = getClient();
  
  // Basic mapping of PR status
  const prMap = new Map(prs.map(p => [p.head.ref, p])); // Map branch to PR

  const sessionData = sessions.map(s => {
    const branch = s.sourceContext?.githubRepoContext?.startingBranch;
    const linkedPr = branch ? prMap.get(branch) : undefined;
    
    return {
       name: s.name,
       state: s.state,
       createTime: s.createTime,
       branch,
       linkedPrStatus: linkedPr ? linkedPr.state : 'none',
       linkedPrMerged: linkedPr ? linkedPr.merged_at : null
    };
  });

  const prompt = `
    Role: AI Session Operator.
    Task: Manage Jules sessions.
    
    Rules:
    - If session FAILED -> 'delete' or 'start_over'.
    - If session SUCCEEDED but no PR -> 'publish' (ask user to create PR).
    - If session is STUCK (Running > 24h) -> 'recover' (check status).
    - If session linked PR is MERGED -> 'delete'.
    
    Output JSON array of actions.
    
    Sessions:
    ${JSON.stringify(sessionData)}
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
            suggestedCommand: { type: Type.STRING, nullable: true }
          },
          required: ['sessionName', 'action', 'reason']
        }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text) as JulesAgentAction[];
};

// 14. Integrator: Suggest Mergeable Branches
export const suggestMergeableBranches = async (prs: EnrichedPullRequest[]): Promise<MergeProposal[]> => {
  if (prs.length < 2) return [];
  const client = getClient();
  
  const prData = prs.map(p => ({
     number: p.number,
     title: p.title,
     branch: p.head.ref,
     base: p.base.ref,
     labels: p.labels.map(l => l.name)
  }));

  const prompt = `
    Role: Release Engineer.
    Task: Group compatible PRs that should be merged together (e.g. all "dependabot" PRs, or all "frontend" PRs).
    
    Output JSON array of proposals.
    
    PRs:
    ${JSON.stringify(prData)}
  `;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
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
  });

  const text = response.text || "[]";
  return JSON.parse(text) as MergeProposal[];
};

// 15. Extract Issues from Comments
export const extractIssuesFromComments = async (
  comments: { id: number; user: string; body: string; url: string }[]
): Promise<ProposedIssue[]> => {
  if (comments.length === 0) return [];
  const client = getClient();

  const prompt = `
    Role: Technical Project Manager.
    Task: Analyze the following comments from a Pull Request review.
    Goal: Identify comments that suggest **future work**, **refactoring**, or **out-of-scope fixes** that should be tracked as new Issues.
    
    Criteria:
    - Look for phrases like "for a future PR", "follow up", "out of scope", "separate issue", "refactor later", "TODO".
    - Ignore simple questions, praise, or immediate change requests for *this* PR.
    
    Output JSON array of proposed issues.
    
    Comments:
    ${JSON.stringify(comments.map(c => ({ user: c.user, body: c.body })))}
  `;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
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
              effort: { type: Type.STRING, enum: ['Small', 'Medium', 'Large'] },
              labels: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['title', 'body', 'reason', 'priority', 'effort', 'labels']
          }
        }
      }
    });

    const text = response.text || "[]";
    return JSON.parse(text) as ProposedIssue[];
  } catch (e) {
    console.warn("Schema validation failed for comments analysis, retrying with raw prompt", e);
    // Fallback: If schema validation fails, try standard generation
    const fallbackResponse = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt + "\n\nReturn strict JSON array of objects only.",
        config: { responseMimeType: 'application/json' }
    });
    const text = fallbackResponse.text || "[]";
    try {
        return JSON.parse(text) as ProposedIssue[];
    } catch (parseError) {
        console.error("Failed to parse fallback response", parseError);
        return [];
    }
  }
};
