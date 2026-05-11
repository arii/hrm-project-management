
import React, { useState, useEffect, useCallback } from 'react';
import { fetchPullRequests, enrichSinglePr, updateIssue, addComment, addLabels, publishPullRequest, fetchPrDiff, updatePullRequestBranch, fetchComments, fetchReviewComments } from '../services/githubService';
import { analyzePullRequests, analyzePrForRestart, analyzePrForSync } from '../services/geminiService';
import { listSessions, createSession, findSourceForRepo, getSessionUrl } from '../services/julesService';
import { storage } from '../services/storageService';
import { EnrichedPullRequest, JulesSession, PrHealthAction, CodeReviewResult } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { 
  GitPullRequest, 
  GitMerge, 
  User, 
  CheckCircle2, 
  FileCode, 
  Check, 
  X, 
  HelpCircle, 
  Loader2, 
  TerminalSquare, 
  Play, 
  Wrench,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Search,
  Eye,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  Plus,
  Bot,
  Key,
  Layers,
  ExternalLink as ExternalLinkIcon,
  FileText,
  PlusSquare,
  MinusSquare,
  ArrowUpCircle
} from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

interface PullRequestsProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type ActionStatus = 'idle' | 'loading' | 'success' | 'error';
type PrActionUI = PrHealthAction & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };

const PullRequests: React.FC<PullRequestsProps> = ({ repoName, token, julesApiKey }) => {
  const navigate = useNavigate();
  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [listProgress, setListProgress] = useState<{ total: number; current: number }>({ total: 0, current: 0 });
  const [error, setError] = useState<string | null>(null);
  const [julesSessions, setJulesSessions] = useState<JulesSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [repairStatuses, setRepairStatuses] = useState<Record<number, ActionStatus>>({});
  const [restartStatuses, setRestartStatuses] = useState<Record<number, ActionStatus>>({});
  const [syncStatuses, setSyncStatuses] = useState<Record<number, ActionStatus>>({});
  const [updateStatuses, setUpdateStatuses] = useState<Record<number, ActionStatus>>({});
  const [dispatchStatuses, setDispatchStatuses] = useState<Record<string, ActionStatus>>({});
  const [sessionLinks, setSessionLinks] = useState<Record<string, string>>({}); // Stores session name for deep links
  const [processingMessages, setProcessingMessages] = useState<Record<number, string>>({});
  const [errorMessages, setErrorMessages] = useState<Record<number, string>>({});

  // Bulk State for GitHub Actions
  const [proposedActions, setProposedActions] = useState<PrActionUI[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  const analysis = useGeminiAnalysis(
    useCallback(async (inputPrs: EnrichedPullRequest[]) => {
      const result = await analyzePullRequests(inputPrs);
      setProposedActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
      return result;
    }, []), 
    'pr_health_check_v4'
  );

  useEffect(() => {
    if (analysis.result && proposedActions.length === 0) {
      setProposedActions(analysis.result.actions.map((a: any) => ({ 
        ...a, 
        _id: Math.random().toString(36).substr(2, 9), 
        status: 'idle' 
      })));
    }
  }, [analysis.result]);

  const loadPrs = async (silent = false, skipCache = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // 1. Fetch BASIC PR list immediately
      const list = await fetchPullRequests(repoName, token, 'open', skipCache);
      const initialPrs = list.map(pr => ({
        ...pr,
        testStatus: 'unknown',
        isApproved: false,
        isBig: false,
        isReadyToMerge: false,
        isLeaderBranch: false
      } as EnrichedPullRequest));
      setPrs(initialPrs);
      
      // Stop skeleton loader
      if (!silent) setLoading(false);

      // 2. Jules sessions in parallel
      if (julesApiKey && julesApiKey.trim()) {
        listSessions(julesApiKey, skipCache).then(setJulesSessions).catch(console.error);
      }

      // 3. Background Enrichment with incremental progress
      const toEnrich = initialPrs.slice(0, 30); // Enrich more here as it's the main list
      setListProgress({ total: toEnrich.length, current: 0 });
      
      const chunkSize = 3; // Reduced from 5 for stability
      let completedCount = 0;
      
      for (let i = 0; i < toEnrich.length; i += chunkSize) {
        const chunk = toEnrich.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (pr) => {
          try {
            const enriched = await enrichSinglePr(repoName, pr, token, false);
            setPrs(prev => prev.map(p => p.number === pr.number ? enriched : p));
          } catch (e) {
            console.warn(`[PullRequests] Failed to enrich PR #${pr.number}`, e);
          } finally {
            completedCount++;
            setListProgress({ total: toEnrich.length, current: completedCount });
          }
        }));
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load pull requests. Please check your connection and settings.");
      if (!silent) setLoading(false);
    } finally {
      setListProgress({ total: 0, current: 0 });
    }
  };

  useEffect(() => {
    if (repoName && token) {
      loadPrs();
    } else {
      setLoading(false);
      if (!token) setError("GitHub Token is missing. Please add it in settings.");
      else if (!repoName) setError("Repository name is missing. Please add it in settings.");
    }
  }, [repoName, token]);

  const updateProcessingMessage = (prNumber: number, msg: string) => {
    setProcessingMessages(prev => ({ ...prev, [prNumber]: msg }));
  };

  const handleDispatchToJules = async (pr: EnrichedPullRequest) => {
    if (!julesApiKey || !token) return;
    setRepairStatuses(prev => ({ ...prev, [pr.number]: 'loading' }));
    updateProcessingMessage(pr.number, "Gathering technical context & reviewer feedback...");
    
    try {
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("A Jules Source ID is required.");
      
      // Fetch diff and comments in parallel
      const [diff, issueComments, reviewComments] = await Promise.all([
        fetchPrDiff(repoName, pr.number, token).catch(() => ""),
        fetchComments(repoName, pr.number, token).catch(() => []),
        fetchReviewComments(repoName, pr.number, token).catch(() => [])
      ]);

      const existingReview: CodeReviewResult | null = storage.getPrReview(repoName, pr.number);
      
      const auditPart = existingReview 
        ? `\n\n### AI AUDIT FEEDBACK (Principal Engineer Directives):\n${existingReview.reviewComment}` 
        : "";

      const prBody = pr.body ? `\n\n### ORIGINAL DEVELOPER INTENT (PR Description):\n${pr.body}` : "";
      
      // Combine human comments
      const allComments = [...issueComments, ...reviewComments]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(c => `- [${c.user?.login || 'unknown'}]: ${c.body}`)
        .join('\n');
      
      const commentPart = allComments ? `\n\n### HUMAN REVIEWER FEEDBACK:\n${allComments}` : "";
      
      const diffPart = diff ? `\n\n### CURRENT CHANGES (Diff):\n${diff.substring(0, 15000)}` : "";

      const prompt = `
        REPAIR PR #${pr.number} on branch '${pr.head.ref}'.
        
        GOAL: Implement all architectural improvements and fixes identified in the feedback and directives below.
        ${auditPart}
        ${prBody}
        ${commentPart}
        ${diffPart}
        
        ### CRITICAL REPAIR DIRECTIVES:
        1. PRESERVE INTENT: The changes in the feature branch are INTENTIONAL. Your goal is to REPAIR and POLISH them, not revert them.
        2. MINIMIZATION: Prioritize code reduction where it doesn't compromise functionality. Remove old features being replaced.
        3. NO OVER-ENGINEERING: Avoid adding complex abstractions, generic wrappers, or unnecessary Providers.
        4. NO VERBOSE COMMENTS: Delete any comments that explain the "how" (code should do that) rather than the "why".
        5. LEVERAGE EXISTING: Do not create new types/hooks if similar ones exist.
        6. SURGICAL FIXES: Address the specific feedback from reviewers and the principal engineer audit.
      `;
      
      const branch = pr.head.ref;
      if (!branch) throw new Error("Could not determine head branch for this PR.");
      
      const session = await createSession(julesApiKey, prompt, sourceId, branch, `Repair Audit: #${pr.number}`);
      setSessionLinks(prev => ({ ...prev, [`repair-${pr.number}`]: session.name }));
      setRepairStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      updateProcessingMessage(pr.number, "Repair session dispatched successfully.");
    } catch (e: any) {
      setRepairStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
      setErrorMessages(prev => ({ ...prev, [pr.number]: e.message }));
    }
  };

  const handleRestartFresh = async (pr: EnrichedPullRequest) => {
    if (!julesApiKey || !token) return;
    setRestartStatuses(prev => ({ ...prev, [pr.number]: 'loading' }));
    updateProcessingMessage(pr.number, "Analyzing PR intent for fresh restart...");
    try {
      const diff = await fetchPrDiff(repoName, pr.number, token);
      if (!diff) throw new Error("Could not retrieve PR diff from GitHub.");
      
      const { plan, title } = await analyzePrForRestart(pr, diff);
      if (!plan || !title) {
        throw new Error("AI failed to generate a restart plan. Please try again.");
      }
      
      updateProcessingMessage(pr.number, "Plan generated. Creating Jules session...");
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("A Jules Source ID is required.");
      
      const existingReview: CodeReviewResult | null = storage.getPrReview(repoName, pr.number);
      const auditPart = existingReview 
        ? `\n\nTECHNICAL ROADMAP FROM PREVIOUS AUDIT:\n${existingReview.reviewComment}` 
        : "";

      const prompt = `
        RESTART PR #${pr.number} FROM SCRATCH.
        
        ${auditPart}
        
        IMPLEMENTATION PLAN:
        ${plan}
        
        GOAL: Build a clean version of this feature on ${pr.base.ref} following the roadmap above.
        
        ### ZERO-SLOP REQUIREMENTS:
        1. ZERO-WASTE: Do not carry over any boilerplate or over-engineered abstractions from the previous PR.
        2. FULL DECOMMISSIONING: Ensure all old code/files intended to be replaced are DELETED in your first few steps.
        3. CODE MINIMIZATION: Prioritize a solution that uses the fewest lines of code possible.
      `;
      
      const branch = pr.base.ref;
      if (!branch) throw new Error("Could not determine base branch for this PR.");
      
      const session = await createSession(julesApiKey, prompt, sourceId, branch, `Restart: ${title}`);
      
      setSessionLinks(prev => ({ ...prev, [`restart-${pr.number}`]: session.name }));
      setRestartStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      updateProcessingMessage(pr.number, "Fresh restart session dispatched successfully.");
    } catch (e: any) {
      setRestartStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
      setErrorMessages(prev => ({ ...prev, [pr.number]: e.message }));
    }
  };

  const handleSyncConflictResolution = async (pr: EnrichedPullRequest) => {
    if (!julesApiKey || !token) return;
    setSyncStatuses(prev => ({ ...prev, [pr.number]: 'loading' }));
    updateProcessingMessage(pr.number, "Analyzing PR for synchronization issues...");
    try {
      const diff = await fetchPrDiff(repoName, pr.number, token);
      if (!diff) throw new Error("Could not retrieve PR diff from GitHub.");

      const { syncIssues } = await analyzePrForSync(pr, diff);
      
      updateProcessingMessage(pr.number, "Issues identified. Creating Jules session...");
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("A Jules Source ID is required.");

      const existingReview: CodeReviewResult | null = storage.getPrReview(repoName, pr.number);
      const auditPart = existingReview 
        ? `\n\nADDITIONAL AUDIT CONTEXT:\n${existingReview.reviewComment}` 
        : "";

      const issuesList = syncIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

      const prompt = `
        AI SYNCHRONIZATION & CONFLICT RESOLUTION SESSION for PR #${pr.number} on branch '${pr.head.ref}'.
        
        GOAL: Restore structural alignment between the feature branch and its parent branch ('${pr.base.ref}') while PROTECTING the feature's intent.
        
        ### IDENTIFIED SYNCHRONIZATION ISSUES:
        ${issuesList}
        ${auditPart}
        
        ### SURGICAL REPAIR DIRECTIVES:
        1. TARGETED REMEDIATION: Focus exclusively on resolving the identified merge conflicts, rebase discrepancies, and "stale-state" issues listed above.
        2. PROTECT INTENTIONAL CHANGES: You MUST NOT revert or delete the core functional changes, business logic, or UI improvements introduced in the feature branch. Success is a clean sync that KEEPS the new feature.
        3. PHANTOM CHANGE DETECTION: Identify and resolve "phantom changes"—lines that appear as PR changes only because the feature branch is missing commits already merged into the base. BE CAREFUL: If a change is not already in the base branch, it is NOT a phantom change.
        4. SNAPSHOT RECONCILIATION: Pay special attention to visual regression or data snapshots. If the base branch updated a snapshot that this PR also modifies, perform a manual reconciliation to ensure the snapshot reflects both the base branch updates AND this PR's intentional changes. Do not simply overwrite with the base version.
        5. OPERATIONAL PRECISION: Operate at the git-structure level. Purge environmental or synchronization artifacts.
        6. CI FIXES: Resolve CI test errors specifically related to synchronization, such as visual regression snapshots that are out of scope or outdated due to base branch changes.
        
        The final delta must represent ONLY the intentional work of the developer, cleaned of all git-related noise.
      `;
      
      const branch = pr.head.ref;
      if (!branch) throw new Error("Could not determine head branch for this PR.");
      
      const session = await createSession(julesApiKey, prompt, sourceId, branch, `Sync & Conflict: #${pr.number}`);
      setSessionLinks(prev => ({ ...prev, [`sync-${pr.number}`]: session.name }));
      setSyncStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      updateProcessingMessage(pr.number, "Synchronization session dispatched successfully.");
    } catch (e: any) {
      setSyncStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
      setErrorMessages(prev => ({ ...prev, [pr.number]: e.message }));
    }
  };

  const handleUpdateBranch = async (pr: EnrichedPullRequest) => {
    if (!token) return;
    setUpdateStatuses(prev => ({ ...prev, [pr.number]: 'loading' }));
    updateProcessingMessage(pr.number, "Updating branch from base...");
    try {
      await updatePullRequestBranch(repoName, pr.number, token);
      setUpdateStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      updateProcessingMessage(pr.number, "Branch updated successfully.");
      // Reload PRs to get fresh state
      setTimeout(() => loadPrs(true, true), 2000);
    } catch (e: any) {
      setUpdateStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
      setErrorMessages(prev => ({ ...prev, [pr.number]: e.message }));
    }
  };

  const handleDispatchActionToJules = async (action: PrActionUI) => {
    if (!julesApiKey) return;
    setDispatchStatuses(prev => ({ ...prev, [action._id]: 'loading' }));
    try {
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("Source not found.");
      const pr = prs.find(p => p.number === action.prNumber);
      const branch = pr?.head.ref || pr?.base.ref || 'main'; // Use main as a last resort if PR info is partially missing
      if (!pr) {
        console.warn(`[PullRequests] PR #${action.prNumber} not found in state, falling back to branch "${branch}"`);
      }
      
      const prompt = `
        AI Recommendation Task for PR #${action.prNumber}: ${action.reason}. 
        Suggested Action: ${action.action.toUpperCase()}.
        
        CRITICAL: Follow ANTI-AI-SLOP protocols. Reduce lines of code, remove redundant comments, and avoid complex abstractions.
      `;
      const session = await createSession(julesApiKey, prompt, sourceId, branch, `Audit Fix: #${action.prNumber}`);
      setSessionLinks(prev => ({ ...prev, [action._id]: session.name }));
      setDispatchStatuses(prev => ({ ...prev, [action._id]: 'success' }));
    } catch (e: any) {
      setDispatchStatuses(prev => ({ ...prev, [action._id]: 'error' }));
    }
  };

  const executeBulkActions = async () => {
    if (!token) return;
    setIsBulkProcessing(true);
    setBulkProgress({ current: 0, total: proposedActions.length });
    
    for (let i = 0; i < proposedActions.length; i++) {
      const action = proposedActions[i];
      setProposedActions(prev => prev.map(p => p._id === action._id ? { ...p, status: 'processing' } : p));
      try {
        if (action.action === 'close') {
          await updateIssue(repoName, token, action.prNumber, { state: 'closed' });
        } else if (action.action === 'comment' && action.suggestedComment) {
          await addComment(repoName, token, action.prNumber, action.suggestedComment);
        } else if (action.action === 'label' && action.label) {
          await addLabels(repoName, token, action.prNumber, [action.label]);
        } else if (action.action === 'publish') {
          await publishPullRequest(repoName, token, action.prNumber);
        }
        setProposedActions(prev => prev.map(p => p._id === action._id ? { ...p, status: 'success' } : p));
      } catch (e) {
        setProposedActions(prev => prev.map(p => p._id === action._id ? { ...p, status: 'error' } : p));
      }
      setBulkProgress(prev => ({ ...prev, current: i + 1 }));
    }
    setIsBulkProcessing(false);
  };

  const filteredPrs = prs.filter(pr => 
    pr.title.toLowerCase().includes(searchQuery.toLowerCase()) || pr.number.toString().includes(searchQuery)
  );

  if (!repoName || !token) {
    return (
      <div className="max-w-4xl mx-auto mt-20">
        <div className="bg-amber-900/20 border border-amber-500/30 rounded-2xl p-12 text-center space-y-6">
          <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto">
            <Key className="w-10 h-10 text-amber-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">Credentials Required</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              To audit pull requests, you must configure your GitHub Repository and Personal Access Token in the settings.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/')} icon={ChevronRight}>
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><GitPullRequest className="text-blue-500 w-8 h-8" /> PR Command Center</h2>
          <p className="text-slate-400">High-level audit and automated re-implementation control center.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="Filter PRs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 bg-surface border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary" />
          </div>
          {isBulkProcessing && (
             <div className="flex items-center gap-3 px-4 py-2 bg-blue-900/20 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-mono">
                <Loader2 className="w-3 h-3 animate-spin" /> Progress: {bulkProgress.current} / {bulkProgress.total}
             </div>
          )}
          <Button variant="secondary" onClick={() => loadPrs(false, true)} isLoading={loading} icon={RefreshCw}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-400 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 items-start">
        {/* LEFT: Audit Results & Recommendations */}
        <div className="xl:col-span-1 space-y-6">
          <AnalysisCard title="Health Audit" description="AI risks & staleness check." status={analysis.status} result={analysis.result?.report || null} onAnalyze={() => analysis.run(prs)} repoName={repoName} disabled={loading || prs.length === 0} />
          
          {proposedActions.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-left-4">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                 <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">AI Action Plan</span>
                 <Button size="sm" variant="success" onClick={executeBulkActions} isLoading={isBulkProcessing} icon={Play}>Run GH Tasks</Button>
              </div>
              <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-700 custom-scrollbar">
                {proposedActions.map(action => (
                  <div key={action._id} className="p-4 flex items-start gap-3 bg-slate-900/30 hover:bg-slate-900/50 transition-colors group">
                    <div className="mt-1">
                      {action.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> : 
                       action.status === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                       <div className="w-4 h-4 rounded-full bg-blue-500/10 border border-blue-500/30 group-hover:border-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                       <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                             <span className="text-[10px] font-mono text-slate-500">#{action.prNumber}</span>
                             <Badge variant="blue" className="text-[9px]">{action.action.toUpperCase()}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {dispatchStatuses[action._id] === 'success' && sessionLinks[action._id] && (
                               <button 
                                 onClick={() => {
                                   window.open(getSessionUrl(sessionLinks[action._id]), '_blank', 'noopener,noreferrer');
                                 }}
                                 className="text-[9px] font-bold text-blue-400 hover:underline flex items-center gap-1 uppercase"
                               >
                                 View Session
                               </button>
                            )}
                            <button 
                              onClick={() => handleDispatchActionToJules(action)}
                              disabled={dispatchStatuses[action._id] === 'loading' || dispatchStatuses[action._id] === 'success'}
                              className="text-[9px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 uppercase disabled:opacity-50"
                            >
                               {dispatchStatuses[action._id] === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <TerminalSquare className="w-3 h-3" />}
                               {dispatchStatuses[action._id] === 'success' ? 'Dispatched' : 'Solve with AI'}
                            </button>
                          </div>
                       </div>
                       <p className="text-[11px] text-slate-400 leading-relaxed">{action.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Active PR Management */}
        <div className="xl:col-span-3 space-y-4">
           {listProgress.total > 0 && (
             <div className="bg-blue-900/10 border border-blue-500/20 rounded-xl p-3 flex items-center justify-between mb-4 animate-in slide-in-from-top-1">
               <div className="flex items-center gap-3">
                 <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                 <div className="flex flex-col">
                   <span className="text-xs font-bold text-white uppercase tracking-wider">Background Sync</span>
                   <span className="text-[10px] text-blue-400 font-mono italic">Finding metadata & checks for item {listProgress.current}/{listProgress.total}...</span>
                 </div>
               </div>
               <div className="flex flex-col items-end gap-1">
                 <span className="text-xs font-mono text-white">{listProgress.current}/{listProgress.total}</span>
                 <div className="w-32 bg-slate-800 rounded-full h-1 overflow-hidden">
                   <div 
                     className="bg-blue-500 h-full transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                     style={{ width: `${(listProgress.current / listProgress.total) * 100}%` }}
                   ></div>
                 </div>
               </div>
             </div>
           )}

           {loading ? (
             <div className="bg-surface border border-slate-700 rounded-xl p-20 flex flex-col items-center justify-center text-slate-500"><Loader2 className="w-10 h-10 animate-spin text-primary mb-4" /><p>Scanning repository pull requests...</p></div>
           ) : filteredPrs.length === 0 ? (
             <div className="bg-surface border border-slate-700 border-dashed rounded-xl p-20 flex flex-col items-center justify-center text-slate-500"><GitPullRequest className="w-12 h-12 mb-4 opacity-20" /><p>No open PRs found matching filters.</p></div>
           ) : filteredPrs.map(pr => {
             const hasAudit = !!storage.getPrReview(repoName, pr.number);
             const repairSuccess = repairStatuses[pr.number] === 'success';
             const restartSuccess = restartStatuses[pr.number] === 'success';
             const syncSuccess = syncStatuses[pr.number] === 'success';

             return (
             <div key={pr.id} className="bg-surface border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-all p-5 flex flex-col md:flex-row gap-6 items-center">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center gap-4 mb-3">
                    <div className={clsx("p-3 rounded-xl", pr.draft ? "bg-slate-800 text-slate-500" : "bg-green-500/10 text-green-500 shadow-inner shadow-green-500/5")}>
                      {pr.draft ? <FileCode className="w-6 h-6" /> : <GitMerge className="w-6 h-6" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-white text-lg truncate hover:text-primary cursor-pointer transition-colors" onClick={() => navigate('/code-review', { state: { selectedPrNumber: pr.number } })}>{pr.title}</h4>
                        {hasAudit && <span title="Full Audit Context Available"><Bot className="w-4 h-4 text-blue-400 shrink-0" /></span>}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                        <span className="font-mono text-blue-400 font-bold">#{pr.number}</span>
                        <span className="h-1 w-1 bg-slate-700 rounded-full" />
                        <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5"/> {pr.user.login}</span>
                        <span className="h-1 w-1 bg-slate-700 rounded-full" />
                        <span className="flex items-center gap-1.5"><Badge variant="slate" className="font-mono text-[9px] bg-slate-900 border-slate-800">{pr.head.ref}</Badge></span>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1 text-[10px] text-slate-400" title="Files Changed">
                          <FileText className="w-3 h-3 text-slate-500" />
                          <span>{pr.changed_files || 0} files</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-green-500/80" title="Additions">
                          <PlusSquare className="w-3 h-3" />
                          <span>+{pr.additions || 0}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-red-500/80" title="Deletions">
                          <MinusSquare className="w-3 h-3" />
                          <span>-{pr.deletions || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {(processingMessages[pr.number] || errorMessages[pr.number]) && (
                    <div className={clsx("mt-4 p-3 rounded-lg text-xs flex items-center gap-3 animate-in slide-in-from-top-1", errorMessages[pr.number] ? "bg-red-900/20 text-red-300 border border-red-800/50" : "bg-blue-900/10 text-blue-300 border border-blue-800/30")}>
                       {(repairStatuses[pr.number] === 'loading' || restartStatuses[pr.number] === 'loading' || syncStatuses[pr.number] === 'loading' || updateStatuses[pr.number] === 'loading') && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                       {(repairSuccess || restartSuccess || syncSuccess || updateStatuses[pr.number] === 'success') && <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />}
                       {errorMessages[pr.number] ? <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" /> : null}
                       <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <span className="font-medium">{errorMessages[pr.number] || processingMessages[pr.number]}</span>
                          {(repairSuccess || restartSuccess || syncSuccess) && (
                            <button 
                              onClick={() => {
                                let sessionKey = "";
                                if (repairSuccess) sessionKey = `repair-${pr.number}`;
                                else if (restartSuccess) sessionKey = `restart-${pr.number}`;
                                else if (syncSuccess) sessionKey = `sync-${pr.number}`;
                                
                                const sessionName = sessionLinks[sessionKey];
                                if (sessionName) {
                                  window.open(getSessionUrl(sessionName), '_blank', 'noopener,noreferrer');
                                }
                              }}
                              className="text-[10px] font-bold text-blue-400 hover:underline uppercase flex items-center gap-1"
                            >
                              <ExternalLinkIcon className="w-3 h-3" /> Go to Session
                            </button>
                          )}
                       </div>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col gap-2 w-full md:w-56 shrink-0 border-l border-slate-700/50 pl-6">
                  <Button 
                    size="sm" 
                    variant={repairSuccess ? "success" : "primary"}
                    onClick={() => handleDispatchToJules(pr)} 
                    isLoading={repairStatuses[pr.number] === 'loading'} 
                    disabled={repairSuccess || restartStatuses[pr.number] === 'loading'}
                    icon={repairSuccess ? Check : Wrench}
                    className="w-full relative"
                  >
                    {repairSuccess ? 'Repair Dispatched' : 'AI Repair Session'}
                    {hasAudit && !repairSuccess && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-400 rounded-full border-2 border-surface shadow-sm animate-pulse" />}
                  </Button>
                  
                  <Button 
                    size="sm" 
                    variant={restartSuccess ? "success" : "secondary"}
                    onClick={() => handleRestartFresh(pr)} 
                    isLoading={restartStatuses[pr.number] === 'loading'} 
                    disabled={restartSuccess || repairStatuses[pr.number] === 'loading'}
                    icon={restartSuccess ? Check : RotateCcw}
                    className={clsx("w-full bg-slate-800 border-slate-700 hover:bg-slate-700", restartSuccess && "!bg-green-600 !border-green-500")}
                  >
                    {restartSuccess ? 'Restart Dispatched' : 'Restart Fresh Session'}
                  </Button>

                  <Button 
                    size="sm" 
                    variant={syncSuccess ? "success" : "secondary"}
                    onClick={() => handleSyncConflictResolution(pr)} 
                    isLoading={syncStatuses[pr.number] === 'loading'} 
                    disabled={syncSuccess || repairStatuses[pr.number] === 'loading' || restartStatuses[pr.number] === 'loading'}
                    icon={syncSuccess ? Check : Layers}
                    className={clsx("w-full bg-slate-800 border-slate-700 hover:bg-slate-700", syncSuccess && "!bg-green-600 !border-green-500")}
                  >
                    {syncSuccess ? 'Sync Dispatched' : 'AI Sync & Conflict'}
                  </Button>

                  <Button 
                    size="sm" 
                    variant={updateStatuses[pr.number] === 'success' ? "success" : "secondary"}
                    onClick={() => handleUpdateBranch(pr)} 
                    isLoading={updateStatuses[pr.number] === 'loading'} 
                    disabled={updateStatuses[pr.number] === 'success' || pr.mergeable_state === 'clean' || pr.mergeable_state === 'dirty' || repairStatuses[pr.number] === 'loading'}
                    icon={updateStatuses[pr.number] === 'success' ? Check : ArrowUpCircle}
                    className={clsx("w-full bg-slate-800 border-slate-700 hover:bg-slate-700", updateStatuses[pr.number] === 'success' && "!bg-green-600 !border-green-500")}
                    title={pr.mergeable_state === 'clean' ? 'Branch is already up to date' : (pr.mergeable_state === 'dirty' ? 'Merge conflicts detected' : 'Update branch from base')}
                  >
                    {updateStatuses[pr.number] === 'success' ? 'Branch Updated' : (pr.mergeable_state === 'clean' ? 'Up to Date' : 'Update Branch')}
                  </Button>

                  <div className="flex gap-2 mt-1">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => navigate('/code-review', { state: { selectedPrNumber: pr.number } })} 
                      icon={Eye} 
                      className="flex-1 text-[10px] h-8 bg-slate-800/50 hover:bg-slate-700"
                    >
                      Audit
                    </Button>
                    <a 
                      href={pr.html_url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-[10px] font-bold border border-slate-700 h-8 flex-1 transition-all"
                    >
                      <ExternalLink className="w-3 h-3" /> GitHub
                    </a>
                  </div>
                </div>
             </div>
           )})}
        </div>
      </div>
    </div>
  );
};

export default PullRequests;
