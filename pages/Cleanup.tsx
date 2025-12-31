
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIssues, fetchPullRequests, updateIssue, addComment, fetchBranches, deleteBranch } from '../services/githubService';
import { generateCleanupReport, analyzeBranchCleanup, analyzeJulesCleanup, analyzePrCleanup } from '../services/geminiService';
import { listSessions, deleteSession } from '../services/julesService';
import { CleanupRecommendation, BranchCleanupRecommendation, JulesCleanupRecommendation, PrCleanupRecommendation } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { CheckCircle, Trash2, MessageSquare, Loader2, Play, GitBranch, TerminalSquare, Copy, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, GitMerge, GitPullRequest, Info, CheckSquare } from 'lucide-react';
import clsx from 'clsx';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';

interface CleanupProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type CleanupItem = CleanupRecommendation & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type BranchItem = BranchCleanupRecommendation & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type JulesItem = JulesCleanupRecommendation & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type PrHygieneItem = PrCleanupRecommendation & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };

const Cleanup: React.FC<CleanupProps> = ({ repoName, token, julesApiKey }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'issues' | 'branches' | 'jules' | 'prs'>('issues');
  const [showRaw, setShowRaw] = useState(false);
  
  const [issueActions, setIssueActions] = useState<CleanupItem[]>([]);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [isIssueProcessing, setIsIssueProcessing] = useState(false);
  
  const [branchCandidates, setBranchCandidates] = useState<BranchItem[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const [isBranchProcessing, setIsBranchProcessing] = useState(false);

  const [julesCandidates, setJulesCandidates] = useState<JulesItem[]>([]);
  const [selectedJulesIds, setSelectedJulesIds] = useState<Set<string>>(new Set());
  const [isJulesProcessing, setIsJulesProcessing] = useState(false);

  const [prHygieneCandidates, setPrHygieneCandidates] = useState<PrHygieneItem[]>([]);
  const [selectedPrHygieneIds, setSelectedPrHygieneIds] = useState<Set<string>>(new Set());
  const [isPrHygieneProcessing, setIsPrHygieneProcessing] = useState(false);

  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const issueAnalysis = useGeminiAnalysis(async () => {
    const [issues, closedPrs] = await Promise.all([
      fetchIssues(repoName, token, 'open'), 
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const result = await generateCleanupReport(issues, closedPrs);
    setIssueActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
    return result;
  }, 'cleanup_issues');

  const branchAnalysis = useGeminiAnalysis(async () => {
    const [allBranches, openPrs, closedPrs] = await Promise.all([
      fetchBranches(repoName, token), 
      fetchPullRequests(repoName, token, 'open'),
      fetchPullRequests(repoName, token, 'closed')
    ]);
    
    const openRefs = openPrs.map(pr => pr.head.ref);
    const closedRefs = closedPrs.map(pr => pr.head.ref);
    const branchNames = allBranches.map(b => b.name);

    const result = await analyzeBranchCleanup(branchNames, openRefs, closedRefs);
    setBranchCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
    return result;
  }, 'cleanup_branches');

  const julesAnalysis = useGeminiAnalysis(async () => {
    if (!julesApiKey) throw new Error("Jules API Key required");
    const [sessions, allPrs, allIssues] = await Promise.all([
      listSessions(julesApiKey), 
      fetchPullRequests(repoName, token, 'all'),
      fetchIssues(repoName, token, 'all')
    ]);

    const result = await analyzeJulesCleanup(sessions, allPrs, allIssues);
    setJulesCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
    return result;
  }, 'cleanup_jules');

  const prHygieneAnalysis = useGeminiAnalysis(async () => {
    const [openPrs, allIssues, closedPrs] = await Promise.all([
      fetchPullRequests(repoName, token, 'open'),
      fetchIssues(repoName, token, 'all'),
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const result = await analyzePrCleanup(openPrs, allIssues, closedPrs);
    setPrHygieneCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), status: 'idle' })));
    return result;
  }, 'cleanup_pr_hygiene');

  const executeBulkIssues = async () => {
    const selected = issueActions.filter(a => selectedIssueIds.has(a._id) && a.status !== 'success');
    if (selected.length === 0) return;
    setIsIssueProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, status: 'processing' } : a));
      try {
        if (item.action === 'close') {
          await addComment(repoName, token, item.issueNumber, item.commentBody || `Closing as resolved via RepoAuditor.\n\n*Reason: ${item.reason}*`);
          await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        } else { await addComment(repoName, token, item.issueNumber, item.commentBody || `Observation: ${item.reason}`); }
        setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, status: 'success' } : a));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, status: 'error' } : a)); }
    }
    setIsIssueProcessing(false);
  };

  const deleteSelectedBranches = async () => {
    const selected = branchCandidates.filter(b => selectedBranchIds.has(b._id) && b.status !== 'success');
    if (selected.length === 0) return;
    setIsBranchProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, status: 'processing' } : b));
      try {
        await deleteBranch(repoName, token, item.branchName);
        setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, status: 'success' } : b));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, status: 'error' } : b)); }
    }
    setIsBranchProcessing(false);
  };

  const deleteSelectedJules = async () => {
    const selected = julesCandidates.filter(j => selectedJulesIds.has(j._id) && j.status !== 'success');
    if (selected.length === 0) return;
    setIsJulesProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, status: 'processing' } : j));
      try {
        const shortName = item.sessionName.split('/').pop() || item.sessionName;
        await deleteSession(julesApiKey!, shortName);
        setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, status: 'success' } : j));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, status: 'error' } : j)); }
    }
    setIsJulesProcessing(false);
  };

  const executeBulkPrHygiene = async () => {
    const selected = prHygieneCandidates.filter(c => selectedPrHygieneIds.has(c._id) && c.status !== 'success');
    if (selected.length === 0) return;
    setIsPrHygieneProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, status: 'processing' } : c));
      try {
        if (item.action === 'close') {
          await addComment(repoName, token, item.prNumber, `Closing this PR as its intended problem is already resolved by a merged PR to leader or a closed issue.\n\n*Reason: ${item.reason}*`);
          await updateIssue(repoName, token, item.prNumber, { state: 'closed' });
        } else {
          await addComment(repoName, token, item.prNumber, `Hygiene Check: ${item.reason}`);
        }
        setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, status: 'success' } : c));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, status: 'error' } : c)); }
    }
    setIsPrHygieneProcessing(false);
  };

  const rawListText = useMemo(() => {
    if (activeTab === 'issues') return issueActions.map(i => `#${i.issueNumber}`).join('\n');
    if (activeTab === 'branches') return branchCandidates.map(b => b.branchName).join('\n');
    if (activeTab === 'jules') return julesCandidates.map(j => j.sessionName.split('/').pop()).join('\n');
    if (activeTab === 'prs') return prHygieneCandidates.map(p => `#${p.prNumber}`).join('\n');
    return '';
  }, [activeTab, issueActions, branchCandidates, julesCandidates, prHygieneCandidates]);

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(rawListText);
    alert("List copied to clipboard.");
  };

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><CheckCircle className="text-green-500 w-8 h-8" /> Cleanup Assistant</h2>
          <p className="text-slate-400">Prune technical debt across issues, branches, PRs, and AI sessions.</p>
        </div>
        {(isIssueProcessing || isBranchProcessing || isJulesProcessing || isPrHygieneProcessing) && (
          <div className="text-sm font-mono text-blue-400 animate-pulse bg-blue-900/10 px-3 py-1.5 rounded-lg border border-blue-500/20">Progress: {progress.current} / {progress.total}</div>
        )}
      </div>

      <div className="flex border-b border-slate-700 mb-8 overflow-x-auto no-scrollbar">
        <button onClick={() => { setActiveTab('issues'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap", activeTab === 'issues' ? "border-primary text-primary" : "border-transparent text-slate-400")}><MessageSquare className="w-4 h-4" /> Issues</button>
        <button onClick={() => { setActiveTab('prs'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap", activeTab === 'prs' ? "border-primary text-primary" : "border-transparent text-slate-400")}><GitPullRequest className="w-4 h-4" /> PR Hygiene</button>
        <button onClick={() => { setActiveTab('branches'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap", activeTab === 'branches' ? "border-primary text-primary" : "border-transparent text-slate-400")}><GitBranch className="w-4 h-4" /> Branches</button>
        <button onClick={() => { setActiveTab('jules'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap", activeTab === 'jules' ? "border-primary text-primary" : "border-transparent text-slate-400")}><TerminalSquare className="w-4 h-4" /> Jules Hygiene</button>
      </div>

      <div className="mb-6 flex justify-end">
        <button 
          onClick={() => setShowRaw(!showRaw)} 
          className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors uppercase font-bold tracking-widest"
        >
          {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showRaw ? 'Hide Raw List' : 'Show Raw List'}
        </button>
      </div>

      {showRaw && (
        <div className="mb-6 animate-in slide-in-from-top-2 duration-200">
           <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Plaintext Target List</span>
                 <button onClick={handleCopyRaw} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy All
                 </button>
              </div>
              <textarea 
                readOnly 
                value={rawListText || 'No targets identified yet. Run analysis below.'}
                className="w-full h-32 bg-transparent p-4 text-xs font-mono text-slate-300 focus:outline-none resize-none"
              />
           </div>
        </div>
      )}

      {activeTab === 'issues' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard title="Cleanup Report" description="Identify zombie issues addressed by merged PRs on leader branch." status={issueAnalysis.status} result={issueAnalysis.result?.report || null} onAnalyze={issueAnalysis.run} repoName={repoName} />
          {issueActions.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selectedIssueIds.size === issueActions.length} onChange={() => setSelectedIssueIds(selectedIssueIds.size === issueActions.length ? new Set() : new Set(issueActions.map(i => i._id)))} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />
                  <span className="text-xs font-bold text-slate-400">Select All Candidates</span>
                </div>
                <Button onClick={executeBulkIssues} disabled={selectedIssueIds.size === 0 || isIssueProcessing} isLoading={isIssueProcessing} variant="success" icon={Play}>Run Selected</Button>
              </div>
              <div className="divide-y divide-slate-700">
                {issueActions.map(item => (
                  <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.status === 'processing' ? "bg-blue-900/10" : "hover:bg-slate-800/20")}>
                    {item.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-blue-500 mt-1" /> : item.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500 mt-1" /> : <input type="checkbox" checked={selectedIssueIds.has(item._id)} onChange={() => { const n = new Set(selectedIssueIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedIssueIds(n); }} className="w-5 h-5 mt-1 rounded bg-slate-800 text-primary" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-slate-500">#{item.issueNumber}</span>
                        <Badge variant={item.action === 'close' ? 'red' : 'yellow'}>{item.action.toUpperCase()}</Badge>
                      </div>
                      <p className="text-sm text-slate-300">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'prs' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard title="PR Hygiene" description="Identify open PRs that target issues already resolved by other MERGED PRs (to leader) or CLOSED issues." status={prHygieneAnalysis.status} result={prHygieneAnalysis.result?.report || null} onAnalyze={prHygieneAnalysis.run} repoName={repoName} />
          {prHygieneCandidates.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selectedPrHygieneIds.size === prHygieneCandidates.length} onChange={() => setSelectedPrHygieneIds(selectedPrHygieneIds.size === prHygieneCandidates.length ? new Set() : new Set(prHygieneCandidates.map(i => i._id)))} className="w-5 h-5 rounded bg-slate-800 text-red-500 cursor-pointer" />
                  <span className="text-xs font-bold text-slate-400">Select Redundant PRs</span>
                </div>
                <Button onClick={executeBulkPrHygiene} disabled={selectedPrHygieneIds.size === 0 || isPrHygieneProcessing} isLoading={isPrHygieneProcessing} variant="danger" icon={Trash2}>Close Selected PRs</Button>
              </div>
              <div className="divide-y divide-slate-700">
                {prHygieneCandidates.map(item => (
                  <div key={item._id} className={clsx("p-6 flex gap-6 transition-all", item.status === 'processing' ? "bg-red-900/5" : "hover:bg-slate-800/10")}>
                    <div className="pt-1">
                       {item.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : 
                        item.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
                        <input type="checkbox" checked={selectedPrHygieneIds.has(item._id)} onChange={() => { const n = new Set(selectedPrHygieneIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedPrHygieneIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-red-500 cursor-pointer" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-bold text-slate-200 truncate pr-4">PR #{item.prNumber}: {item.title}</h4>
                        <Badge variant="red">{item.action.toUpperCase()}</Badge>
                      </div>
                      <p className="text-sm text-slate-400 mb-4">{item.reason}</p>
                      <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
                        <span className="text-[10px] font-black text-slate-600 uppercase mb-2 block tracking-widest">Verification Evidence</span>
                        <div className="flex flex-wrap gap-2">
                          {item.evidenceLinks.map((link, idx) => {
                            const isMergedToLeader = link.type === 'pr' && link.state === 'merged';
                            const isClosedIssue = link.type === 'issue' && link.state === 'closed';
                            return (
                              <a 
                                key={idx} 
                                href={link.url} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className={clsx(
                                  "flex items-center gap-2 px-3 py-1.5 rounded border transition-all group",
                                  (isMergedToLeader || isClosedIssue) ? "bg-green-500/10 border-green-500/30 hover:border-green-500/60" : "bg-slate-950/40 border-slate-800/50 hover:border-slate-500/50"
                                )}
                              >
                                 {link.type === 'issue' ? <MessageSquare className="w-3 h-3 text-yellow-400" /> : <GitMerge className="w-3 h-3 text-purple-400" />}
                                 <span className="text-[11px] font-mono text-slate-300">
                                   #{link.number} 
                                   <span className={clsx("ml-1 font-bold", isMergedToLeader ? "text-green-400" : isClosedIssue ? "text-green-400" : "text-slate-500")}>
                                     ({isMergedToLeader ? 'MERGED TO LEADER' : isClosedIssue ? 'CLOSED ISSUE' : link.state.toUpperCase()})
                                   </span>
                                 </span>
                                 <ExternalLink className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100" />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard title="Branch Cleanup" description="Detect zombie or orphaned branches not linked to open PRs." status={branchAnalysis.status} result={branchAnalysis.result?.report || null} onAnalyze={branchAnalysis.run} repoName={repoName} />
          {branchCandidates.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selectedBranchIds.size === branchCandidates.length} onChange={() => setSelectedBranchIds(selectedBranchIds.size === branchCandidates.length ? new Set() : new Set(branchCandidates.map(i => i._id)))} className="w-5 h-5 rounded bg-slate-800 text-red-500 cursor-pointer" />
                  <span className="text-xs font-bold text-slate-400">Select All Candidates</span>
                </div>
                <Button onClick={deleteSelectedBranches} disabled={selectedBranchIds.size === 0 || isBranchProcessing} isLoading={isBranchProcessing} variant="danger" icon={Trash2}>Delete Selected</Button>
              </div>
              <div className="divide-y divide-slate-700">
                {branchCandidates.map(item => (
                  <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.status === 'processing' ? "bg-red-900/10" : "hover:bg-slate-800/20")}>
                    {item.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500 mt-1" /> : item.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500 mt-1" /> : <input type="checkbox" checked={selectedBranchIds.has(item._id)} onChange={() => { const n = new Set(selectedBranchIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedBranchIds(n); }} className="w-5 h-5 mt-1 rounded bg-slate-800 text-red-500" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-mono text-slate-200">{item.branchName}</span>
                        <Badge variant="slate">{item.type}</Badge>
                      </div>
                      <p className="text-xs text-slate-400">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'jules' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard title="Jules Hygiene" description="Identify sessions that are safe to delete because their work is merged to leader, target issue closed, or they are stale/failed." status={julesAnalysis.status} result={julesAnalysis.result?.report || null} onAnalyze={julesAnalysis.run} repoName={repoName} />
          {julesCandidates.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selectedJulesIds.size === julesCandidates.length} onChange={() => setSelectedJulesIds(selectedJulesIds.size === julesCandidates.length ? new Set() : new Set(julesCandidates.map(i => i._id)))} className="w-5 h-5 rounded bg-slate-800 text-red-500 cursor-pointer" />
                  <span className="text-xs font-bold text-slate-400">Select Sessions to Prune</span>
                </div>
                <Button onClick={deleteSelectedJules} disabled={selectedJulesIds.size === 0 || isJulesProcessing} isLoading={isJulesProcessing} variant="danger" icon={Trash2}>Delete Sessions</Button>
              </div>
              <div className="divide-y divide-slate-700">
                {julesCandidates.map(item => {
                  const shortName = item.sessionName.split('/').pop() || item.sessionName;
                  return (
                    <div key={item._id} className={clsx("p-6 flex gap-6 transition-all", item.status === 'processing' ? "bg-red-900/5" : "hover:bg-slate-800/10")}>
                      <div className="pt-1">
                        {item.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : 
                         item.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
                         <input type="checkbox" checked={selectedJulesIds.has(item._id)} onChange={() => { const n = new Set(selectedJulesIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedJulesIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-red-500 cursor-pointer" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-2">
                          <div className="min-w-0 pr-4">
                             <div className="flex items-center gap-3 mb-1">
                               <h4 className="font-bold text-slate-200 truncate">{item.sessionTitle || 'Untitled Session'}</h4>
                               <Badge variant={item.status === 'merged' ? 'green' : (item.status === 'redundant' ? 'purple' : 'slate')}>{item.status}</Badge>
                             </div>
                             <button 
                               onClick={() => navigate('/sessions', { state: { viewSessionName: item.sessionName } })}
                               className="text-[10px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1.5 bg-blue-500/5 px-2.5 py-1 rounded border border-blue-500/10 transition-colors"
                             >
                               <TerminalSquare className="w-3 h-3" /> Visit Workspace: <span className="underline">{shortName}</span>
                             </button>
                          </div>
                        </div>
                        
                        <p className="text-sm text-slate-400 leading-relaxed mb-4">{item.reason}</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {item.publishedPrs && item.publishedPrs.length > 0 && (
                            <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
                               <span className="text-[10px] font-black text-slate-600 uppercase mb-2 block tracking-widest">Published Pull Requests</span>
                               <div className="space-y-2">
                                 {item.publishedPrs.map(pr => (
                                   <a 
                                     key={pr.number} 
                                     href={pr.url} 
                                     target="_blank" 
                                     rel="noopener noreferrer" 
                                     className={clsx(
                                       "flex items-center justify-between p-2 rounded border transition-all group",
                                       pr.merged ? "bg-green-500/5 border-green-500/20 hover:border-green-500/50" : "bg-slate-950/40 border-slate-800/50 hover:border-blue-500/50"
                                     )}
                                   >
                                      <div className="flex items-center gap-2 overflow-hidden">
                                         <GitPullRequest className={clsx("w-3 h-3", pr.merged ? "text-green-400" : (pr.state === 'closed' ? "text-red-400" : "text-blue-400"))} />
                                         <span className="text-[11px] font-mono text-slate-400">#{pr.number}</span>
                                         <Badge variant={pr.merged ? 'green' : (pr.state === 'closed' ? 'red' : 'blue')} className="text-[8px] py-0 px-1 font-mono">
                                           {pr.merged ? 'MERGED TO LEADER' : pr.state.toUpperCase()}
                                         </Badge>
                                      </div>
                                      <ExternalLink className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                   </a>
                                 ))}
                               </div>
                            </div>
                          )}

                          {item.relatedIssueNumber && (
                            <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
                               <span className="text-[10px] font-black text-slate-600 uppercase mb-2 block tracking-widest">Target Issue Status</span>
                               <a 
                                 href={`https://github.com/${repoName}/issues/${item.relatedIssueNumber}`}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="flex items-center justify-between p-2 bg-green-500/5 rounded border border-green-500/20 hover:border-green-500/50 transition-all group"
                               >
                                  <div className="flex items-center gap-2 overflow-hidden">
                                     <MessageSquare className="w-3 h-3 text-green-400" />
                                     <span className="text-[11px] font-mono text-slate-400">Issue #{item.relatedIssueNumber}</span>
                                     <Badge variant="green" className="text-[8px] py-0 px-1 font-mono">CLOSED (FIXED)</Badge>
                                  </div>
                                  <ExternalLink className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                               </a>
                               <div className="mt-2 text-[10px] text-green-500/70 italic flex items-center gap-1.5 font-bold">
                                 <Info className="w-3 h-3" />
                                 Problem resolved: target issue is fixed.
                               </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Cleanup;
