
import React, { useState, useEffect, useCallback } from 'react';
import { fetchEnrichedPullRequests, updateIssue, addComment, addLabels, publishPullRequest, fetchPrDiff } from '../services/githubService';
import { analyzePullRequests, analyzePrForRestart } from '../services/geminiService';
import { listSessions, createSession, findSourceForRepo } from '../services/julesService';
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
  Bot
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
  const [julesSessions, setJulesSessions] = useState<JulesSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [repairStatuses, setRepairStatuses] = useState<Record<number, ActionStatus>>({});
  const [restartStatuses, setRestartStatuses] = useState<Record<number, ActionStatus>>({});
  const [dispatchStatuses, setDispatchStatuses] = useState<Record<string, ActionStatus>>({});
  const [processingMessages, setProcessingMessages] = useState<Record<number, string>>({});
  const [errorMessages, setErrorMessages] = useState<Record<number, string>>({});

  // Bulk State for GitHub Actions
  const [proposedActions, setProposedActions] = useState<PrActionUI[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  const analysis = useGeminiAnalysis(async (inputPrs) => {
    const result = await analyzePullRequests(inputPrs);
    setProposedActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
    return result;
  }, 'pr_health_check_v4');

  const loadPrs = async (silent = false, skipCache = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchEnrichedPullRequests(repoName, token, skipCache);
      setPrs(data);
      if (julesApiKey && julesApiKey.trim()) {
        const sessions = await listSessions(julesApiKey);
        setJulesSessions(sessions);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (repoName && token) loadPrs();
  }, [repoName, token]);

  const updateProcessingMessage = (prNumber: number, msg: string) => {
    setProcessingMessages(prev => ({ ...prev, [prNumber]: msg }));
  };

  const handleDispatchToJules = async (pr: EnrichedPullRequest) => {
    if (!julesApiKey) return;
    setRepairStatuses(prev => ({ ...prev, [pr.number]: 'loading' }));
    updateProcessingMessage(pr.number, "Gathering technical context...");
    
    try {
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("Source context not found.");
      
      // CHECK FOR EXISTING AUDIT
      const existingReview: CodeReviewResult | null = storage.getPrReview(repoName, pr.number);
      const auditPart = existingReview 
        ? `\n\nPRINCIPAL ENGINEER DIRECTIVES (FROM PREVIOUS AUDIT):\n${existingReview.reviewComment}` 
        : "";

      const prompt = `REPAIR PR #${pr.number} on branch '${pr.head.ref}'.\n${auditPart}\n\nGOAL: Implement all architectural improvements and fixes identified in the directives above. Ensure type safety, resolve conflicts, and maintain repository patterns.`;
      
      const session = await createSession(julesApiKey, prompt, sourceId, pr.head.ref, `Repair Audit: #${pr.number}`);
      setRepairStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      setTimeout(() => navigate('/sessions', { state: { viewSessionName: session.name } }), 1000);
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
      const { plan, title } = await analyzePrForRestart(pr, diff);
      
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("Source context not found.");
      
      // CHECK FOR EXISTING AUDIT
      const existingReview: CodeReviewResult | null = storage.getPrReview(repoName, pr.number);
      const auditPart = existingReview 
        ? `\n\nTECHNICAL ROADMAP FROM PREVIOUS AUDIT:\n${existingReview.reviewComment}` 
        : "";

      const prompt = `RESTART PR #${pr.number} FROM SCRATCH.\n\n${auditPart}\n\nIMPLEMENTATION PLAN:\n${plan}\n\nGOAL: Build a clean version of this feature on ${pr.base.ref} following the roadmap above.`;
      
      const session = await createSession(julesApiKey, prompt, sourceId, pr.base.ref, `Restart: ${title}`);
      
      setRestartStatuses(prev => ({ ...prev, [pr.number]: 'success' }));
      setTimeout(() => navigate('/sessions', { state: { viewSessionName: session.name } }), 1000);
    } catch (e: any) {
      setRestartStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
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
      const branch = pr?.head.ref || 'leader';
      const prompt = `AI Recommendation Task for PR #${action.prNumber}: ${action.reason}. Suggested Action: ${action.action.toUpperCase()}.`;
      const session = await createSession(julesApiKey, prompt, sourceId, branch, `Audit Fix: #${action.prNumber}`);
      setDispatchStatuses(prev => ({ ...prev, [action._id]: 'success' }));
      setTimeout(() => navigate('/sessions', { state: { viewSessionName: session.name } }), 800);
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
                          <button 
                            onClick={() => handleDispatchActionToJules(action)}
                            disabled={dispatchStatuses[action._id] === 'loading' || dispatchStatuses[action._id] === 'success'}
                            className="text-[9px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 uppercase disabled:opacity-50"
                          >
                             {dispatchStatuses[action._id] === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <TerminalSquare className="w-3 h-3" />}
                             Solve with AI
                          </button>
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
           {loading ? (
             <div className="bg-surface border border-slate-700 rounded-xl p-20 flex flex-col items-center justify-center text-slate-500"><Loader2 className="w-10 h-10 animate-spin text-primary mb-4" /><p>Scanning repository pull requests...</p></div>
           ) : filteredPrs.length === 0 ? (
             <div className="bg-surface border border-slate-700 border-dashed rounded-xl p-20 flex flex-col items-center justify-center text-slate-500"><GitPullRequest className="w-12 h-12 mb-4 opacity-20" /><p>No open PRs found matching filters.</p></div>
           ) : filteredPrs.map(pr => {
             const hasAudit = !!storage.getPrReview(repoName, pr.number);
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
                        {hasAudit && <Bot className="w-4 h-4 text-blue-400 shrink-0" title="Full Audit Context Available" />}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                        <span className="font-mono text-blue-400 font-bold">#{pr.number}</span>
                        <span className="h-1 w-1 bg-slate-700 rounded-full" />
                        <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5"/> {pr.user.login}</span>
                        <span className="h-1 w-1 bg-slate-700 rounded-full" />
                        <span className="flex items-center gap-1.5"><Badge variant="slate" className="font-mono text-[9px] bg-slate-900 border-slate-800">{pr.head.ref}</Badge></span>
                      </div>
                    </div>
                  </div>
                  {(processingMessages[pr.number] || errorMessages[pr.number]) && (
                    <div className={clsx("mt-4 p-3 rounded-lg text-xs flex items-center gap-3 animate-in slide-in-from-top-1", errorMessages[pr.number] ? "bg-red-900/20 text-red-300 border border-red-800/50" : "bg-blue-900/10 text-blue-300 border border-blue-800/30")}>
                       {(repairStatuses[pr.number] === 'loading' || restartStatuses[pr.number] === 'loading') && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                       {errorMessages[pr.number] ? <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" /> : null}
                       <span className="font-medium">{errorMessages[pr.number] || processingMessages[pr.number]}</span>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col gap-2 w-full md:w-56 shrink-0 border-l border-slate-700/50 pl-6">
                  <Button 
                    size="sm" 
                    variant="primary" 
                    onClick={() => handleDispatchToJules(pr)} 
                    isLoading={repairStatuses[pr.number] === 'loading'} 
                    disabled={repairStatuses[pr.number] === 'success' || restartStatuses[pr.number] === 'loading'}
                    icon={Wrench}
                    className="w-full relative"
                  >
                    AI Repair Session
                    {hasAudit && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-400 rounded-full border-2 border-surface shadow-sm animate-pulse" />}
                  </Button>
                  
                  <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => handleRestartFresh(pr)} 
                    isLoading={restartStatuses[pr.number] === 'loading'} 
                    disabled={restartStatuses[pr.number] === 'success' || repairStatuses[pr.number] === 'loading'}
                    icon={RotateCcw}
                    className="w-full bg-slate-800 border-slate-700 hover:bg-slate-700"
                  >
                    Restart Fresh Session
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
