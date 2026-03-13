
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIssues, fetchPullRequests, updateIssue, addComment, fetchBranches, deleteBranch, createIssue } from '../services/githubService';
import { generateCleanupReport, analyzeBranchCleanup, analyzeJulesCleanup, analyzePrCleanup, analyzeIssueRedundancy } from '../services/geminiService';
import { listSessions, deleteSession } from '../services/julesService';
import { CleanupRecommendation, BranchCleanupRecommendation, JulesCleanupRecommendation, PrCleanupRecommendation, RedundancyAnalysisResult } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { CheckCircle, Trash2, MessageSquare, Loader2, Play, GitBranch, TerminalSquare, Copy, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, GitMerge, GitPullRequest, Info, CheckSquare, Layers, Sparkles, Plus } from 'lucide-react';
import clsx from 'clsx';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';

interface CleanupProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type CleanupItem = CleanupRecommendation & { _id: string; uiStatus: 'idle' | 'processing' | 'success' | 'error' };
type BranchItem = BranchCleanupRecommendation & { _id: string; uiStatus: 'idle' | 'processing' | 'success' | 'error' };
type JulesItem = JulesCleanupRecommendation & { _id: string; uiStatus: 'idle' | 'processing' | 'success' | 'error' };
type PrHygieneItem = PrCleanupRecommendation & { _id: string; uiStatus: 'idle' | 'processing' | 'success' | 'error' };

// Redundancy UI Types
type RedundantItemUI = { 
  issueNumber: number; 
  reason: string; 
  _id: string; 
  uiStatus: 'idle' | 'processing' | 'success' | 'error' 
};

type ConsolidatedItemUI = {
  title: string;
  body: string;
  labels: string[];
  reason: string;
  replacesIssueNumbers: number[];
  _id: string;
  uiStatus: 'idle' | 'processing' | 'success' | 'error'
};

const Cleanup: React.FC<CleanupProps> = ({ repoName, token, julesApiKey }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'issues' | 'prs' | 'duplicates' | 'branches' | 'jules'>('issues');
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

  // Redundancy States
  const [redundantItems, setRedundantItems] = useState<RedundantItemUI[]>([]);
  const [consolidatedItems, setConsolidatedItems] = useState<ConsolidatedItemUI[]>([]);
  const [selectedRedundantIds, setSelectedRedundantIds] = useState<Set<string>>(new Set());
  const [selectedConsolidatedIds, setSelectedConsolidatedIds] = useState<Set<string>>(new Set());
  const [isRedundancyProcessing, setIsRedundancyProcessing] = useState(false);

  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const issueAnalysis = useGeminiAnalysis(async () => {
    const [issues, closedPrs] = await Promise.all([
      fetchIssues(repoName, token, 'open'), 
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const result = await generateCleanupReport(issues, closedPrs);
    setIssueActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    return result;
  }, 'cleanup_issues_v2');

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
    setBranchCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    return result;
  }, 'cleanup_branches_v2');

  const julesAnalysis = useGeminiAnalysis(async () => {
    if (!julesApiKey) throw new Error("Jules API Key required");
    const [sessions, allPrs, allIssues] = await Promise.all([
      listSessions(julesApiKey), 
      fetchPullRequests(repoName, token, 'all'),
      fetchIssues(repoName, token, 'all')
    ]);

    const result = await analyzeJulesCleanup(sessions, allPrs, allIssues);
    setJulesCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    return result;
  }, 'cleanup_jules_v2');

  const prHygieneAnalysis = useGeminiAnalysis(async () => {
    const [openPrs, allIssues, closedPrs] = await Promise.all([
      fetchPullRequests(repoName, token, 'open'),
      fetchIssues(repoName, token, 'all'),
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const result = await analyzePrCleanup(openPrs, allIssues, closedPrs);
    setPrHygieneCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    return result;
  }, 'cleanup_pr_hygiene_v2');

  const redundancyAnalysis = useGeminiAnalysis(async () => {
    const issues = await fetchIssues(repoName, token, 'open');
    const result = await analyzeIssueRedundancy(issues);
    setRedundantItems(result.redundantIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    setConsolidatedItems(result.consolidatedIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9), uiStatus: 'idle' })));
    return result;
  }, 'cleanup_redundancy_v2');

  const executeBulkIssues = async () => {
    const selected = issueActions.filter(a => selectedIssueIds.has(a._id) && a.uiStatus !== 'success');
    if (selected.length === 0) return;
    setIsIssueProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, uiStatus: 'processing' } : a));
      try {
        if (item.action === 'close') {
          await addComment(repoName, token, item.issueNumber, item.commentBody || `Closing as resolved via RepoAuditor.\n\n*Reason: ${item.reason}*`);
          await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        } else { await addComment(repoName, token, item.issueNumber, item.commentBody || `Observation: ${item.reason}`); }
        setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, uiStatus: 'success' } : a));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setIssueActions(prev => prev.map(a => a._id === item._id ? { ...a, uiStatus: 'error' } : a)); }
    }
    setIsIssueProcessing(false);
  };

  const deleteSelectedBranches = async () => {
    const selected = branchCandidates.filter(b => selectedBranchIds.has(b._id) && b.uiStatus !== 'success');
    if (selected.length === 0) return;
    setIsBranchProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, uiStatus: 'processing' } : b));
      try {
        await deleteBranch(repoName, token, item.branchName);
        setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, uiStatus: 'success' } : b));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setBranchCandidates(prev => prev.map(b => b._id === item._id ? { ...b, uiStatus: 'error' } : b)); }
    }
    setIsBranchProcessing(false);
  };

  const deleteSelectedJules = async () => {
    const selected = julesCandidates.filter(j => selectedJulesIds.has(j._id) && j.uiStatus !== 'success');
    if (selected.length === 0) return;
    setIsJulesProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, uiStatus: 'processing' } : j));
      try {
        const shortName = item.sessionName.split('/').pop() || item.sessionName;
        await deleteSession(julesApiKey!, shortName);
        setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, uiStatus: 'success' } : j));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setJulesCandidates(prev => prev.map(j => j._id === item._id ? { ...j, uiStatus: 'error' } : j)); }
    }
    setIsJulesProcessing(false);
  };

  const executeBulkPrHygiene = async () => {
    const selected = prHygieneCandidates.filter(c => selectedPrHygieneIds.has(c._id) && c.uiStatus !== 'success');
    if (selected.length === 0) return;
    setIsPrHygieneProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, uiStatus: 'processing' } : c));
      try {
        if (item.action === 'close') {
          await addComment(repoName, token, item.prNumber, `Closing this PR as its intended problem is already resolved by a merged PR to leader or a closed issue.\n\n*Reason: ${item.reason}*`);
          await updateIssue(repoName, token, item.prNumber, { state: 'closed' });
        } else {
          await addComment(repoName, token, item.prNumber, `Hygiene Check: ${item.reason}`);
        }
        setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, uiStatus: 'success' } : c));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (e) { setPrHygieneCandidates(prev => prev.map(c => c._id === item._id ? { ...c, uiStatus: 'error' } : c)); }
    }
    setIsPrHygieneProcessing(false);
  };

  const executeBulkRedundancy = async () => {
    const selectedRedundant = redundantItems.filter(i => selectedRedundantIds.has(i._id) && i.uiStatus !== 'success');
    const selectedConsolidated = consolidatedItems.filter(i => selectedConsolidatedIds.has(i._id) && i.uiStatus !== 'success');
    
    if (selectedRedundant.length === 0 && selectedConsolidated.length === 0) return;
    
    setIsRedundancyProcessing(true);
    setProgress({ current: 0, total: selectedRedundant.length + selectedConsolidated.length });
    
    let completed = 0;

    // Process pure redundant issues (Close them)
    for (const item of selectedRedundant) {
      setRedundantItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'processing' } : i));
      try {
        await addComment(repoName, token, item.issueNumber, `Closing as duplicate via RepoAuditor.\n\n*Reason: ${item.reason}*`);
        await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        setRedundantItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'success' } : i));
      } catch (e) {
        setRedundantItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'error' } : i));
      }
      completed++;
      setProgress(p => ({ ...p, current: completed }));
    }

    // Process consolidated issues (Create new, close old)
    for (const item of selectedConsolidated) {
      setConsolidatedItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'processing' } : i));
      try {
        const body = `${item.body}\n\n---\n*Created via AI Backlog Consolidation.*\n*Replaces: ${item.replacesIssueNumbers.map(n => `#${n}`).join(', ')}*`;
        await createIssue(repoName, token, { title: item.title, body, labels: [...item.labels, 'consolidated'] });
        
        for (const num of item.replacesIssueNumbers) {
          await addComment(repoName, token, num, `Closing in favor of consolidated ticket: "${item.title}".\n\n*Reason: ${item.reason}*`);
          await updateIssue(repoName, token, num, { state: 'closed' });
        }
        setConsolidatedItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'success' } : i));
      } catch (e) {
        setConsolidatedItems(prev => prev.map(i => i._id === item._id ? { ...i, uiStatus: 'error' } : i));
      }
      completed++;
      setProgress(p => ({ ...p, current: completed }));
    }

    setIsRedundancyProcessing(false);
  };

  const rawListText = useMemo(() => {
    if (activeTab === 'issues') return issueActions.map(i => `#${i.issueNumber}`).join('\n');
    if (activeTab === 'branches') return branchCandidates.map(b => b.branchName).join('\n');
    if (activeTab === 'jules') return julesCandidates.map(j => j.sessionName.split('/').pop()).join('\n');
    if (activeTab === 'prs') return prHygieneCandidates.map(p => `#${p.prNumber}`).join('\n');
    if (activeTab === 'duplicates') {
      const red = redundantItems.map(i => `#${i.issueNumber}`).join('\n');
      const cons = consolidatedItems.map(i => `Replace ${i.replacesIssueNumbers.join(', ')} with "${i.title}"`).join('\n');
      return `REDUNDANT:\n${red}\n\nCONSOLIDATIONS:\n${cons}`;
    }
    return '';
  }, [activeTab, issueActions, branchCandidates, julesCandidates, prHygieneCandidates, redundantItems, consolidatedItems]);

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(rawListText);
    alert("List copied to clipboard.");
  };

  return (
    <div className="max-w-[1400px] mx-auto pb-20">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><CheckCircle className="text-green-500 w-8 h-8" /> Cleanup Assistant</h2>
          <p className="text-slate-400">Prune technical debt across issues, branches, PRs, and AI sessions.</p>
        </div>
        {(isIssueProcessing || isBranchProcessing || isJulesProcessing || isPrHygieneProcessing || isRedundancyProcessing) && (
          <div className="text-sm font-mono text-blue-400 animate-pulse bg-blue-900/10 px-3 py-1.5 rounded-lg border border-blue-500/20">Progress: {progress.current} / {progress.total}</div>
        )}
      </div>

      <div className="flex border-b border-slate-700 mb-8 overflow-x-auto no-scrollbar">
        <button onClick={() => { setActiveTab('issues'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-all", activeTab === 'issues' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}><MessageSquare className="w-4 h-4" /> Zombie Issues</button>
        <button onClick={() => { setActiveTab('duplicates'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-all", activeTab === 'duplicates' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}><Layers className="w-4 h-4" /> Duplicates</button>
        <button onClick={() => { setActiveTab('prs'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-all", activeTab === 'prs' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}><GitPullRequest className="w-4 h-4" /> PR Hygiene</button>
        <button onClick={() => { setActiveTab('branches'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-all", activeTab === 'branches' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}><GitBranch className="w-4 h-4" /> Branches</button>
        <button onClick={() => { setActiveTab('jules'); setShowRaw(false); }} className={clsx("flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-all", activeTab === 'jules' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}><TerminalSquare className="w-4 h-4" /> Jules Hygiene</button>
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
          <AnalysisCard title="Zombie Issue Report" description="Identify issues that were intended to be solved by PRs that have already been MERGED to leader branch." status={issueAnalysis.status} result={issueAnalysis.result?.report || null} onAnalyze={issueAnalysis.run} repoName={repoName} />
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
                  <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.uiStatus === 'processing' ? "bg-blue-900/10" : "hover:bg-slate-800/20")}>
                    {item.uiStatus === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-blue-500 mt-1" /> : item.uiStatus === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500 mt-1" /> : <input type="checkbox" checked={selectedIssueIds.has(item._id)} onChange={() => { const n = new Set(selectedIssueIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedIssueIds(n); }} className="w-5 h-5 mt-1 rounded bg-slate-800 text-primary" />}
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

      {activeTab === 'duplicates' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard title="Backlog Redundancy" description="AI audit of the entire open backlog to detect semantic duplicates and consolidation opportunities." status={redundancyAnalysis.status} result={null} onAnalyze={redundancyAnalysis.run} repoName={repoName} />
          {(redundantItems.length > 0 || consolidatedItems.length > 0) && (
            <div className="space-y-6">
               <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actionable Findings</h3>
                  <Button onClick={executeBulkRedundancy} disabled={isRedundancyProcessing || (selectedRedundantIds.size === 0 && selectedConsolidatedIds.size === 0)} isLoading={isRedundancyProcessing} variant="primary" icon={Sparkles}>Apply Cleanups</Button>
               </div>
               
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* PURE REDUNDANT */}
                  <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
                    <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
                       <span className="text-xs font-bold text-white uppercase tracking-widest">Duplicates ({redundantItems.length})</span>
                       <input type="checkbox" checked={selectedRedundantIds.size === redundantItems.length && redundantItems.length > 0} onChange={() => setSelectedRedundantIds(selectedRedundantIds.size === redundantItems.length ? new Set() : new Set(redundantItems.map(i => i._id)))} className="w-4 h-4 rounded bg-slate-800 text-primary cursor-pointer" />
                    </div>
                    <div className="divide-y divide-slate-700 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {redundantItems.length === 0 ? <p className="p-12 text-center text-slate-500 italic text-sm">No exact duplicates identified.</p> : redundantItems.map(item => (
                        <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.uiStatus === 'processing' ? "bg-red-900/5" : "hover:bg-slate-800/20")}>
                           <div className="pt-1">
                              {item.uiStatus === 'processing' ? <Loader2 className="w-4 h-4 animate-spin text-red-500" /> : item.uiStatus === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <input type="checkbox" checked={selectedRedundantIds.has(item._id)} onChange={() => { const n = new Set(selectedRedundantIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedRedundantIds(n); }} className="w-4 h-4 rounded bg-slate-800 text-red-500" />}
                           </div>
                           <div className="flex-1 min-w-0">
                              <span className="text-xs font-mono text-slate-500 block mb-1">#{item.issueNumber}</span>
                              <p className="text-sm text-slate-300 font-medium leading-relaxed">{item.reason}</p>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* CONSOLIDATIONS */}
                  <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg">
                    <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
                       <span className="text-xs font-bold text-white uppercase tracking-widest">Consolidations ({consolidatedItems.length})</span>
                       <input type="checkbox" checked={selectedConsolidatedIds.size === consolidatedItems.length && consolidatedItems.length > 0} onChange={() => setSelectedConsolidatedIds(selectedConsolidatedIds.size === consolidatedItems.length ? new Set() : new Set(consolidatedItems.map(i => i._id)))} className="w-4 h-4 rounded bg-slate-800 text-primary cursor-pointer" />
                    </div>
                    <div className="divide-y divide-slate-700 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {consolidatedItems.length === 0 ? <p className="p-12 text-center text-slate-500 italic text-sm">No consolidation opportunities found.</p> : consolidatedItems.map(item => (
                        <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.uiStatus === 'processing' ? "bg-purple-900/5" : "hover:bg-slate-800/20")}>
                           <div className="pt-1">
                              {item.uiStatus === 'processing' ? <Loader2 className="w-4 h-4 animate-spin text-purple-500" /> : item.uiStatus === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <input type="checkbox" checked={selectedConsolidatedIds.has(item._id)} onChange={() => { const n = new Set(selectedConsolidatedIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedConsolidatedIds(n); }} className="w-4 h-4 rounded bg-slate-800 text-purple-500" />}
                           </div>
                           <div className="flex-1 min-w-0">
                              <h4 className="text-slate-200 font-bold text-sm mb-1">{item.title}</h4>
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="purple" className="text-[8px]">Combined</Badge>
                                <span className="text-[10px] text-slate-500 font-mono">Replaces: {item.replacesIssueNumbers.map(n => `#${n}`).join(', ')}</span>
                              </div>
                              <p className="text-[11px] text-slate-400 italic line-clamp-2">"{item.reason}"</p>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
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
                  <div key={item._id} className={clsx("p-6 flex gap-6 transition-all", item.uiStatus === 'processing' ? "bg-red-900/5" : "hover:bg-slate-800/10")}>
                    <div className="pt-1">
                       {item.uiStatus === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : 
                        item.uiStatus === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
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
                  <div key={item._id} className={clsx("p-4 flex gap-4 transition-colors", item.uiStatus === 'processing' ? "bg-red-900/10" : "hover:bg-slate-800/20")}>
                    {item.uiStatus === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500 mt-1" /> : item.uiStatus === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500 mt-1" /> : <input type="checkbox" checked={selectedBranchIds.has(item._id)} onChange={() => { const n = new Set(selectedBranchIds); if (n.has(item._id)) n.delete(item._id); else n.add(item._id); setSelectedBranchIds(n); }} className="w-5 h-5 mt-1 rounded bg-slate-800 text-red-500" />}
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
                    <div key={item._id} className={clsx("p-6 flex gap-6 transition-all", item.uiStatus === 'processing' ? "bg-red-900/5" : "hover:bg-slate-800/10")}>
                      <div className="pt-1">
                        {item.uiStatus === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : 
                         item.uiStatus === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
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
