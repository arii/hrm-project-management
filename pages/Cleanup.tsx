
import React, { useState } from 'react';
import { fetchIssues, fetchPullRequests, updateIssue, addComment, fetchBranches, deleteBranch } from '../services/githubService';
import { generateCleanupReport, analyzeBranchCleanup } from '../services/geminiService';
import { AnalysisStatus, CleanupRecommendation, BranchCleanupRecommendation } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { CheckCircle, ArrowRight, Trash2, MessageSquare, Loader2, Play, GitBranch, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import Button from '../components/ui/Button';

interface CleanupProps {
  repoName: string;
  token: string;
}

// Local type for UI state
type CleanupItem = CleanupRecommendation & { _id: string };
type BranchItem = BranchCleanupRecommendation & { _id: string };

const Cleanup: React.FC<CleanupProps> = ({ repoName, token }) => {
  const [activeTab, setActiveTab] = useState<'issues' | 'branches'>('issues');
  
  // -- ISSUE HYGIENE STATE --
  const [issueStatus, setIssueStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [issueReport, setIssueReport] = useState<string | null>(null);
  const [actions, setActions] = useState<CleanupItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  // -- BRANCH HYGIENE STATE --
  const [branchStatus, setBranchStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [branchReport, setBranchReport] = useState<string | null>(null);
  const [branchesToDelete, setBranchesToDelete] = useState<BranchItem[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const [isBranchProcessing, setIsBranchProcessing] = useState(false);

  // --- ISSUE HANDLERS ---
  const handleGenerateReport = async () => {
    setIssueStatus(AnalysisStatus.LOADING);
    setActions([]);
    setIssueReport(null);
    try {
      const [issues, closedPrs] = await Promise.all([
        fetchIssues(repoName, token, 'open'),
        fetchPullRequests(repoName, token, 'closed')
      ]);

      const result = await generateCleanupReport(issues, closedPrs);
      setIssueReport(result.report);
      setActions(result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9) })));
      setSelectedIds(new Set()); // Reset selection
      setIssueStatus(AnalysisStatus.COMPLETE);
    } catch (e) {
      console.error(e);
      setIssueStatus(AnalysisStatus.ERROR);
    }
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === actions.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(actions.map(a => a._id)));
  };

  const executeAction = async (item: CleanupItem) => {
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
      
      setActions(prev => prev.filter(a => a._id !== item._id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(item._id);
        return next;
      });
    } catch (e: any) {
      alert(`Failed to execute action on #${item.issueNumber}: ${e.message}`);
    }
  };

  const executeBulkActions = async () => {
    if (!token) return alert("GitHub token required.");
    setIsProcessing(true);
    
    const selected = actions.filter(a => selectedIds.has(a._id));
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
      } catch (e) {
        console.error(`Failed on #${item.issueNumber}`, e);
      }
    }

    setActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedIds(prev => {
       const next = new Set(prev);
       successIds.forEach(id => next.delete(id));
       return next;
    });
    setIsProcessing(false);
  };

  // --- BRANCH HANDLERS ---
  const handleBranchAnalysis = async () => {
    if (!token) return alert("GitHub token required.");
    setBranchStatus(AnalysisStatus.LOADING);
    setBranchesToDelete([]);
    setBranchReport(null);
    try {
      // Fetch branches and CLOSED PRs (to see what was merged)
      const [allBranches, closedPrs] = await Promise.all([
        fetchBranches(repoName, token),
        fetchPullRequests(repoName, token, 'closed')
      ]);

      const branchNames = allBranches.map(b => b.name);
      
      // Filter for merged PRs
      const mergedRefs = closedPrs
        .filter(pr => pr.merged_at)
        .map(pr => ({ ref: pr.head.ref, number: pr.number }));

      const result = await analyzeBranchCleanup(branchNames, mergedRefs);
      
      setBranchReport(result.report);
      setBranchesToDelete(result.candidates.map(c => ({ ...c, _id: Math.random().toString(36).substr(2,9) })));
      setSelectedBranchIds(new Set());
      setBranchStatus(AnalysisStatus.COMPLETE);
    } catch (e) {
      console.error(e);
      setBranchStatus(AnalysisStatus.ERROR);
    }
  };

  const toggleBranchSelection = (id: string) => {
    const newSet = new Set(selectedBranchIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedBranchIds(newSet);
  };

  const toggleAllBranches = () => {
    if (selectedBranchIds.size === branchesToDelete.length) setSelectedBranchIds(new Set());
    else setSelectedBranchIds(new Set(branchesToDelete.map(b => b._id)));
  };

  const deleteSelectedBranches = async () => {
    if (!token) return alert("GitHub token required.");
    if (!window.confirm(`Permanently delete ${selectedBranchIds.size} branches? This cannot be undone.`)) return;
    
    setIsBranchProcessing(true);
    const selected = branchesToDelete.filter(b => selectedBranchIds.has(b._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        await deleteBranch(repoName, token, item.branchName);
        successIds.push(item._id);
      } catch (e) {
        console.error(`Failed to delete branch ${item.branchName}`, e);
      }
    }

    setBranchesToDelete(prev => prev.filter(b => !successIds.includes(b._id)));
    setSelectedBranchIds(prev => {
      const next = new Set(prev);
      successIds.forEach(id => next.delete(id));
      return next;
    });
    setIsBranchProcessing(false);
  };

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
      </div>

      {/* --- ISSUE TAB CONTENT --- */}
      {activeTab === 'issues' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-gradient-to-r from-blue-900/20 to-indigo-900/20 border border-blue-800/30 rounded-xl p-6">
             <h3 className="text-white font-semibold mb-2">How it works</h3>
             <div className="flex items-center gap-4 text-sm text-slate-300">
               <div className="bg-slate-800 p-2 rounded">Fetch Closed PRs</div>
               <ArrowRight className="w-4 h-4 text-slate-500" />
               <div className="bg-slate-800 p-2 rounded">Fetch Open Issues</div>
               <ArrowRight className="w-4 h-4 text-slate-500" />
               <div className="bg-primary/20 text-primary border border-primary/20 p-2 rounded font-medium">Gemini Analysis</div>
             </div>
          </div>

          <AnalysisCard 
            title="Cleanup Report"
            description="Identify 'zombie' issues that should be closed."
            status={issueStatus}
            result={issueReport}
            onAnalyze={handleGenerateReport}
            repoName={repoName}
          />

          {actions.length > 0 && (
            <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <h3 className="font-semibold text-white">Recommended Actions ({actions.length})</h3>
                   <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-slate-900 rounded border border-slate-700">
                     <input 
                        type="checkbox"
                        checked={actions.length > 0 && selectedIds.size === actions.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer"
                     />
                     <span className="text-xs text-slate-400">Select All</span>
                   </div>
                </div>
                
                <Button 
                  onClick={executeBulkActions}
                  disabled={selectedIds.size === 0 || isProcessing}
                  isLoading={isProcessing}
                  variant="success"
                  icon={Play}
                >
                  Execute Selected ({selectedIds.size})
                </Button>
              </div>

              <div className="divide-y divide-slate-700">
                {actions.map((item) => (
                  <div key={item._id} className={clsx(
                    "p-5 transition-colors flex gap-5 group",
                    selectedIds.has(item._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20"
                  )}>
                     <div className="pt-1">
                        <input 
                          type="checkbox"
                          checked={selectedIds.has(item._id)}
                          onChange={() => toggleSelection(item._id)}
                          className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer"
                        />
                     </div>

                     <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={clsx(
                            "px-2 py-0.5 rounded text-[10px] uppercase font-bold border",
                            item.action === 'close' ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          )}>
                            {item.action}
                          </span>
                          <span className="text-slate-200 font-medium">Issue #{item.issueNumber}</span>
                          {item.prReference && (
                            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                              Ref: PR #{item.prReference}
                            </span>
                          )}
                          <span className={clsx(
                             "text-[10px] px-1.5 rounded uppercase font-bold",
                             item.confidence === 'high' ? "text-green-500" : "text-amber-500"
                          )}>
                             {item.confidence} Confidence
                          </span>
                        </div>
                        
                        <p className="text-slate-300 text-sm mb-3">{item.reason}</p>
                        
                        {item.commentBody && (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-700/50 text-xs text-slate-400 font-mono">
                             <p className="mb-1 text-[10px] text-slate-500 uppercase font-bold">Proposed Comment:</p>
                             {item.commentBody}
                          </div>
                        )}
                     </div>

                     <button 
                       onClick={() => executeAction(item)}
                       disabled={isProcessing}
                       className={clsx(
                         "self-start p-2 rounded-lg transition-colors border",
                         item.action === 'close' 
                           ? "text-red-400 border-red-500/20 hover:bg-red-500/10" 
                           : "text-blue-400 border-blue-500/20 hover:bg-blue-500/10"
                       )}
                       title={item.action === 'close' ? "Close Issue" : "Post Comment"}
                     >
                       {item.action === 'close' ? <Trash2 className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                     </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- BRANCH TAB CONTENT --- */}
      {activeTab === 'branches' && (
        <div className="space-y-6 animate-in fade-in">
           <div className="bg-surface border border-slate-700 rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-2">Merged & Stale Branches</h3>
              <p className="text-slate-400 mb-6 text-sm">
                Identify branches that have been merged into the main codebase but were not deleted, or branches that appear abandoned.
              </p>

              <AnalysisCard 
                title="Branch Hygiene Report"
                description="Scan for zombie branches merged via PRs."
                status={branchStatus}
                result={branchReport}
                onAnalyze={handleBranchAnalysis}
                repoName={repoName}
              />
           </div>

           {branchesToDelete.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                     <h3 className="font-semibold text-white">Candidates for Deletion ({branchesToDelete.length})</h3>
                     <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-slate-900 rounded border border-slate-700">
                       <input 
                          type="checkbox"
                          checked={branchesToDelete.length > 0 && selectedBranchIds.size === branchesToDelete.length}
                          onChange={toggleAllBranches}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-0 cursor-pointer"
                       />
                       <span className="text-xs text-slate-400">Select All</span>
                     </div>
                  </div>
                  
                  <Button 
                    onClick={deleteSelectedBranches}
                    disabled={selectedBranchIds.size === 0 || isBranchProcessing}
                    isLoading={isBranchProcessing}
                    variant="danger"
                    icon={Trash2}
                  >
                    Delete Selected ({selectedBranchIds.size})
                  </Button>
                </div>

                <div className="divide-y divide-slate-700 max-h-[600px] overflow-y-auto">
                   {branchesToDelete.map((branch) => (
                      <div key={branch._id} className={clsx(
                        "p-4 flex gap-4 transition-colors",
                        selectedBranchIds.has(branch._id) ? "bg-red-900/10" : "hover:bg-slate-800/20"
                      )}>
                         <div className="pt-1">
                            <input 
                              type="checkbox"
                              checked={selectedBranchIds.has(branch._id)}
                              onChange={() => toggleBranchSelection(branch._id)}
                              className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-0 cursor-pointer"
                            />
                         </div>
                         <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                               <GitBranch className="w-4 h-4 text-slate-500" />
                               <span className="font-mono font-medium text-slate-200">{branch.branchName}</span>
                               <span className={clsx(
                                 "text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border",
                                 branch.type === 'merged' ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                               )}>
                                 {branch.type}
                               </span>
                            </div>
                            <p className="text-sm text-slate-400">{branch.reason}</p>
                         </div>
                      </div>
                   ))}
                </div>
             </div>
           )}
        </div>
      )}
    </div>
  );
};

export default Cleanup;
