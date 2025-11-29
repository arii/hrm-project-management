
import React, { useState } from 'react';
import { fetchIssues, fetchPullRequests, updateIssue, addComment, fetchBranches, deleteBranch } from '../services/githubService';
import { generateCleanupReport, analyzeBranchCleanup, analyzeJulesCleanup } from '../services/geminiService';
import { listSessions, deleteSession } from '../services/julesService';
import { AnalysisStatus, CleanupRecommendation, BranchCleanupRecommendation, JulesCleanupRecommendation } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { CheckCircle, ArrowRight, Trash2, MessageSquare, Loader2, Play, GitBranch, TerminalSquare, Copy, Clipboard } from 'lucide-react';
import clsx from 'clsx';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';

interface CleanupProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

// Local type for UI state
type CleanupItem = CleanupRecommendation & { _id: string };
type BranchItem = BranchCleanupRecommendation & { _id: string };
type JulesItem = JulesCleanupRecommendation & { _id: string };

const Cleanup: React.FC<CleanupProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'issues' | 'branches' | 'jules'>('issues');
  
  // -- ISSUE HYGIENE STATE --
  const [issueActions, setIssueActions] = useState<CleanupItem[]>([]);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [isIssueProcessing, setIsIssueProcessing] = useState(false);

  // -- BRANCH HYGIENE STATE --
  const [branchCandidates, setBranchCandidates] = useState<BranchItem[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const [isBranchProcessing, setIsBranchProcessing] = useState(false);

  // -- JULES HYGIENE STATE --
  const [julesCandidates, setJulesCandidates] = useState<JulesItem[]>([]);
  const [selectedJulesIds, setSelectedJulesIds] = useState<Set<string>>(new Set());
  const [isJulesProcessing, setIsJulesProcessing] = useState(false);

  // Analysis Hooks
  const issueAnalysis = useGeminiAnalysis(async () => {
    const [issues, closedPrs] = await Promise.all([
      fetchIssues(repoName, token, 'open'),
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const result = await generateCleanupReport(issues, closedPrs);
    setIssueActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9) })));
    return result;
  }, 'cleanup_issues');

  const branchAnalysis = useGeminiAnalysis(async () => {
    const [allBranches, closedPrs] = await Promise.all([
      fetchBranches(repoName, token),
      fetchPullRequests(repoName, token, 'closed')
    ]);
    const branchNames = allBranches.map(b => b.name);
    const mergedRefs = closedPrs.filter(pr => pr.merged_at).map(pr => ({ ref: pr.head.ref, number: pr.number }));
    const result = await analyzeBranchCleanup(branchNames, mergedRefs);
    setBranchCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9) })));
    return result;
  }, 'cleanup_branches');

  const julesAnalysis = useGeminiAnalysis(async () => {
    if (!julesApiKey) throw new Error("Jules API Key required");
    const [sessions, closedPrs] = await Promise.all([
      listSessions(julesApiKey),
      fetchPullRequests(repoName, token, 'closed') // Includes merged & unmerged closed PRs
    ]);
    const result = await analyzeJulesCleanup(sessions, closedPrs);
    setJulesCandidates(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2, 9) })));
    return result;
  }, 'cleanup_jules');

  // --- ISSUE HANDLERS ---
  const executeIssueAction = async (item: CleanupItem) => {
    if (!token) return alert("GitHub token required.");
    try {
      if (item.action === 'close') {
        const comment = item.commentBody || `Closing as resolved by recent PRs.\n\n*Reason: ${item.reason}*`;
        await addComment(repoName, token, item.issueNumber, comment);
        await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
      } else if (item.action === 'comment') {
        const comment = item.commentBody || `Is this issue still relevant? \n\n*Observation: ${item.reason}*`;
        await addComment(repoName, token, item.issueNumber, comment);
      }
      
      setIssueActions(prev => prev.filter(a => a._id !== item._id));
      setSelectedIssueIds(prev => { const next = new Set(prev); next.delete(item._id); return next; });
    } catch (e: any) { alert(`Failed on #${item.issueNumber}: ${e.message}`); }
  };

  const executeBulkIssues = async () => {
    if (!token) return alert("GitHub token required.");
    setIsIssueProcessing(true);
    const selected = issueActions.filter(a => selectedIssueIds.has(a._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        if (item.action === 'close') {
          const comment = item.commentBody || `Closing as resolved by recent PRs.\n\n*Reason: ${item.reason}*`;
          await addComment(repoName, token, item.issueNumber, comment);
          await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        } else if (item.action === 'comment') {
          const comment = item.commentBody || `Is this issue still relevant? \n\n*Observation: ${item.reason}*`;
          await addComment(repoName, token, item.issueNumber, comment);
        }
        successIds.push(item._id);
      } catch (e) { console.error(e); }
    }

    setIssueActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedIssueIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setIsIssueProcessing(false);
  };

  // --- BRANCH HANDLERS ---
  const deleteSelectedBranches = async () => {
    if (!token) return alert("GitHub token required.");
    if (!window.confirm(`Delete ${selectedBranchIds.size} branches?`)) return;
    setIsBranchProcessing(true);
    const selected = branchCandidates.filter(b => selectedBranchIds.has(b._id));
    const successIds: string[] = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < selected.length; i += BATCH_SIZE) {
        const batch = selected.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            try {
                await deleteBranch(repoName, token, item.branchName);
                successIds.push(item._id);
            } catch (e) { console.error(e); }
        }));
    }

    setBranchCandidates(prev => prev.filter(b => !successIds.includes(b._id)));
    setSelectedBranchIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setIsBranchProcessing(false);
  };

  const handleCopyBranchNames = () => {
    const names = branchCandidates.map(c => c.branchName).join('\n');
    navigator.clipboard.writeText(names);
    alert(`Copied ${branchCandidates.length} branch names to clipboard.`);
  };

  // --- JULES HANDLERS ---
  const deleteSelectedJules = async () => {
    if (!julesApiKey) return alert("Jules API Key required.");
    if (!window.confirm(`Permanently delete ${selectedJulesIds.size} sessions?`)) return;
    setIsJulesProcessing(true);
    
    const selected = julesCandidates.filter(j => selectedJulesIds.has(j._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        const shortName = item.sessionName.split('/').pop() || item.sessionName;
        await deleteSession(julesApiKey, shortName);
        successIds.push(item._id);
      } catch (e) { console.error(e); }
    }

    setJulesCandidates(prev => prev.filter(j => !successIds.includes(j._id)));
    setSelectedJulesIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setIsJulesProcessing(false);
  };

  // Helper for Toggle All
  const toggleAll = (items: { _id: string }[], setIds: Set<string>, setFunction: (s: Set<string>) => void) => {
    if (setIds.size === items.length) setFunction(new Set());
    else setFunction(new Set(items.map(i => i._id)));
  };

  const toggleOne = (id: string, setIds: Set<string>, setFunction: (s: Set<string>) => void) => {
    const next = new Set(setIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFunction(next);
  };

  // Computed raw lists for text areas
  const rawBranchList = branchCandidates.map(b => b.branchName).join(' ');
  const rawJulesList = julesCandidates.map(j => j.sessionName.split('/').pop()).join(' ');

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <CheckCircle className="text-green-500 w-8 h-8" />
          Cleanup Assistant
        </h2>
        <p className="text-slate-400">
          Maintain repository hygiene by closing zombie issues and deleting stale branches.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 mb-8">
        <button 
          onClick={() => setActiveTab('issues')}
          className={clsx(
            "flex items-center gap-2 px-6 py-4 font-medium transition-colors border-b-2",
            activeTab === 'issues' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-white"
          )}
        >
          <MessageSquare className="w-4 h-4" /> Issue Hygiene
        </button>
        <button 
          onClick={() => setActiveTab('branches')}
          className={clsx(
            "flex items-center gap-2 px-6 py-4 font-medium transition-colors border-b-2",
            activeTab === 'branches' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-white"
          )}
        >
          <GitBranch className="w-4 h-4" /> Branch Hygiene
        </button>
        <button 
          onClick={() => setActiveTab('jules')}
          className={clsx(
            "flex items-center gap-2 px-6 py-4 font-medium transition-colors border-b-2",
            activeTab === 'jules' ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-white"
          )}
        >
          <TerminalSquare className="w-4 h-4" /> Jules Hygiene
        </button>
      </div>

      {/* --- ISSUE TAB --- */}
      {activeTab === 'issues' && (
        <div className="space-y-6 animate-in fade-in">
          <AnalysisCard 
            title="Cleanup Report"
            description="Identify 'zombie' issues that should be closed."
            status={issueAnalysis.status}
            result={issueAnalysis.result?.report || null}
            onAnalyze={issueAnalysis.run}
            repoName={repoName}
          />

          {issueActions.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <input type="checkbox" checked={issueActions.length > 0 && selectedIssueIds.size === issueActions.length} onChange={() => toggleAll(issueActions, selectedIssueIds, setSelectedIssueIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                   <h3 className="font-semibold text-white">Recommended Actions ({issueActions.length})</h3>
                </div>
                <Button onClick={executeBulkIssues} disabled={selectedIssueIds.size === 0 || isIssueProcessing} isLoading={isIssueProcessing} variant="success" icon={Play}>Execute Selected</Button>
              </div>
              <div className="divide-y divide-slate-700">
                {issueActions.map(item => (
                  <div key={item._id} className={clsx("p-5 flex gap-5 transition-colors", selectedIssueIds.has(item._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                     <div className="pt-1"><input type="checkbox" checked={selectedIssueIds.has(item._id)} onChange={() => toggleOne(item._id, selectedIssueIds, setSelectedIssueIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" /></div>
                     <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center gap-2 mb-1">
                             <span className="text-sm font-mono text-slate-500">#{item.issueNumber}</span>
                             <Badge variant={item.action === 'close' ? 'red' : 'yellow'}>{item.action.toUpperCase()}</Badge>
                             <Badge variant={item.confidence === 'high' ? 'green' : 'gray'}>{item.confidence} Confidence</Badge>
                           </div>
                           <Button size="sm" variant="secondary" onClick={() => executeIssueAction(item)} icon={Play}>Run</Button>
                        </div>
                        <p className="text-slate-300 text-sm">{item.reason}</p>
                        {item.prReference && <div className="text-xs text-slate-500 mt-2">Referenced PR: #{item.prReference}</div>}
                     </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- BRANCH TAB --- */}
      {activeTab === 'branches' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard 
            title="Branch Cleanup"
            description="Identify stale or merged branches that can be deleted."
            status={branchAnalysis.status}
            result={branchAnalysis.result?.report || null}
            onAnalyze={branchAnalysis.run}
            repoName={repoName}
          />
          
          {branchCandidates.length > 0 && (
             <>
                {/* Text Area for raw copy */}
                <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden p-4">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                    <Clipboard className="w-3 h-3" /> Raw Candidate List (Space Separated)
                  </label>
                  <textarea 
                    readOnly 
                    value={rawBranchList}
                    className="w-full h-24 bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-slate-300 font-mono text-xs focus:outline-none focus:border-primary resize-none"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <p className="text-[10px] text-slate-500 mt-2">Click to select all, then copy (Ctrl+C).</p>
                </div>

                <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={branchCandidates.length > 0 && selectedBranchIds.size === branchCandidates.length} onChange={() => toggleAll(branchCandidates, selectedBranchIds, setSelectedBranchIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer" />
                        <h3 className="font-semibold text-white">Candidates for Deletion ({branchCandidates.length})</h3>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={handleCopyBranchNames} icon={Copy}>Copy List</Button>
                        <Button onClick={deleteSelectedBranches} disabled={selectedBranchIds.size === 0 || isBranchProcessing} isLoading={isBranchProcessing} variant="danger" icon={Trash2}>Delete Selected</Button>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-700">
                      {branchCandidates.map(branch => (
                        <div key={branch._id} className={clsx("p-4 flex items-center gap-4 transition-colors", selectedBranchIds.has(branch._id) ? "bg-red-900/10" : "hover:bg-slate-800/20")}>
                            <input type="checkbox" checked={selectedBranchIds.has(branch._id)} onChange={() => toggleOne(branch._id, selectedBranchIds, setSelectedBranchIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <div className="flex items-center gap-2 font-mono text-sm text-slate-200"><GitBranch className="w-4 h-4 text-slate-500" />{branch.branchName}</div>
                                <Badge variant={branch.type === 'merged' ? 'green' : branch.type === 'abandoned' ? 'red' : 'yellow'}>{branch.type}</Badge>
                              </div>
                              <p className="text-sm text-slate-400">{branch.reason}</p>
                            </div>
                        </div>
                      ))}
                    </div>
                </div>
             </>
          )}
        </div>
      )}

      {/* --- JULES TAB --- */}
      {activeTab === 'jules' && (
        <div className="space-y-6 animate-in fade-in">
          {!julesApiKey && (
             <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-200">
                Please configure your Jules API Key in settings to use this feature.
             </div>
          )}
          <AnalysisCard 
            title="Jules Session Hygiene"
            description="Identify obsolete sessions linked to merged or closed Pull Requests."
            status={julesAnalysis.status}
            result={julesAnalysis.result?.report || null}
            onAnalyze={julesAnalysis.run}
            repoName={repoName}
          />

          {julesCandidates.length > 0 && (
             <>
                {/* Text Area for raw copy */}
                <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden p-4">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                    <Clipboard className="w-3 h-3" /> Raw Session IDs (Space Separated)
                  </label>
                  <textarea 
                    readOnly 
                    value={rawJulesList}
                    className="w-full h-24 bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-slate-300 font-mono text-xs focus:outline-none focus:border-primary resize-none"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <p className="text-[10px] text-slate-500 mt-2">Click to select all, then copy (Ctrl+C).</p>
                </div>

                <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={julesCandidates.length > 0 && selectedJulesIds.size === julesCandidates.length} onChange={() => toggleAll(julesCandidates, selectedJulesIds, setSelectedJulesIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer" />
                        <h3 className="font-semibold text-white">Candidates for Deletion ({julesCandidates.length})</h3>
                      </div>
                      <Button onClick={deleteSelectedJules} disabled={selectedJulesIds.size === 0 || isJulesProcessing} isLoading={isJulesProcessing} variant="danger" icon={Trash2}>Delete Selected</Button>
                    </div>

                    <div className="divide-y divide-slate-700">
                      {julesCandidates.map(item => (
                        <div key={item._id} className={clsx("p-4 flex items-center gap-4 transition-colors", selectedJulesIds.has(item._id) ? "bg-red-900/10" : "hover:bg-slate-800/20")}>
                            <input type="checkbox" checked={selectedJulesIds.has(item._id)} onChange={() => toggleOne(item._id, selectedJulesIds, setSelectedJulesIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <div className="flex items-center gap-2 font-mono text-sm text-slate-200"><TerminalSquare className="w-4 h-4 text-slate-500" />{item.sessionName.split('/').pop()}</div>
                                <Badge variant={item.status === 'merged' ? 'green' : 'red'}>{item.status.toUpperCase()}</Badge>
                              </div>
                              <p className="text-sm text-slate-400">{item.reason}</p>
                              {item.linkedPrNumber && <div className="text-xs text-slate-500 mt-1">Linked PR #{item.linkedPrNumber} is closed.</div>}
                            </div>
                        </div>
                      ))}
                    </div>
                </div>
             </>
          )}
        </div>
      )}
    </div>
  );
};

export default Cleanup;
