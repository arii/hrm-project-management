
import React, { useState, useEffect } from 'react';
import { fetchIssues, updateIssue, createIssue, addLabels } from '../services/githubService';
import { analyzeIssueRedundancy, generateTriageReport, identifyRedundantCandidates } from '../services/geminiService';
import { GithubIssue, AnalysisStatus, RedundancyAnalysisResult, TriageAnalysisResult, TriageAction } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { AlertCircle, Tag, ExternalLink, Sparkles, CheckSquare, Trash2, Loader2, Plus, Copy, Check, Play, Gauge, Box } from 'lucide-react';
import clsx from 'clsx';

interface IssuesProps {
  repoName: string;
  token: string;
}

// Local types for UI interaction
type ConsolidatedIssueUI = RedundancyAnalysisResult['consolidatedIssues'][0] & { _id: string };
type RedundantIssueUI = RedundancyAnalysisResult['redundantIssues'][0] & { _id: string };
type TriageActionUI = TriageAction & { _id: string };

const Issues: React.FC<IssuesProps> = ({ repoName, token }) => {
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selection State (Main List)
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<number>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [autoSelectLoading, setAutoSelectLoading] = useState(false);
  
  // Analysis State
  const [redundancyStatus, setRedundancyStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [redundancyData, setRedundancyData] = useState<RedundancyAnalysisResult | null>(null);
  
  // Redundancy Action State
  const [createCandidates, setCreateCandidates] = useState<ConsolidatedIssueUI[]>([]);
  const [closeCandidates, setCloseCandidates] = useState<RedundantIssueUI[]>([]);
  const [selectedCreateIds, setSelectedCreateIds] = useState<Set<string>>(new Set());
  const [selectedCloseIds, setSelectedCloseIds] = useState<Set<string>>(new Set());
  const [actionProcessing, setActionProcessing] = useState(false);
  const [activeRedundancyTab, setActiveRedundancyTab] = useState<'consolidate' | 'prune'>('consolidate');

  // Triage State
  const [triageStatus, setTriageStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [triageData, setTriageData] = useState<TriageAnalysisResult | null>(null);
  const [triageActions, setTriageActions] = useState<TriageActionUI[]>([]);
  const [selectedTriageIds, setSelectedTriageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadIssues();
  }, [repoName, token]);

  const loadIssues = async () => {
    setLoading(true);
    try {
      const data = await fetchIssues(repoName, token, 'open');
      setIssues(data);
      setSelectedIssueIds(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRedundancyCheck = async () => {
    setRedundancyStatus(AnalysisStatus.LOADING);
    setCreateCandidates([]);
    setCloseCandidates([]);
    try {
      const result = await analyzeIssueRedundancy(issues);
      setRedundancyData(result);
      
      // Init UI state
      setCreateCandidates(result.consolidatedIssues.map(i => ({...i, _id: Math.random().toString(36).substr(2,9)})));
      setCloseCandidates(result.redundantIssues.map(i => ({...i, _id: Math.random().toString(36).substr(2,9)})));
      
      setRedundancyStatus(AnalysisStatus.COMPLETE);
    } catch (e) {
      setRedundancyStatus(AnalysisStatus.ERROR);
    }
  };

  const handleTriageReport = async () => {
    setTriageStatus(AnalysisStatus.LOADING);
    setTriageActions([]);
    try {
      const result = await generateTriageReport(issues);
      setTriageData(result);
      // Init UI state for actions
      setTriageActions(result.actions.map(a => ({...a, _id: Math.random().toString(36).substr(2,9)})));
      setSelectedTriageIds(new Set());
      setTriageStatus(AnalysisStatus.COMPLETE);
    } catch (e) {
      setTriageStatus(AnalysisStatus.ERROR);
    }
  };

  // --- Bulk Action Handlers (Main List) ---

  const toggleSelection = (id: number) => {
    const newSelection = new Set(selectedIssueIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIssueIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedIssueIds.size === issues.length) {
      setSelectedIssueIds(new Set());
    } else {
      setSelectedIssueIds(new Set(issues.map(i => i.number)));
    }
  };

  const handleAutoSelect = async () => {
    setAutoSelectLoading(true);
    try {
      const redundantIds = await identifyRedundantCandidates(issues);
      const newSelection = new Set(selectedIssueIds);
      
      if (Array.isArray(redundantIds)) {
        redundantIds.forEach((val: unknown) => {
          const id = Number(val);
          if (!isNaN(id) && issues.find(i => i.number === id)) {
             newSelection.add(id);
          }
        });
      }
      setSelectedIssueIds(newSelection);
    } catch (e) {
      alert("Failed to run AI detection");
    } finally {
      setAutoSelectLoading(false);
    }
  };

  const handleBulkClose = async () => {
    if (!token) return alert("GitHub Token required in settings.");
    if (!window.confirm(`Are you sure you want to close ${selectedIssueIds.size} issues?`)) return;

    setIsBulkProcessing(true);
    const ids = Array.from(selectedIssueIds);
    
    for (const id of ids) {
      try {
        await updateIssue(repoName, token, id as number, { state: 'closed' });
      } catch (e) {
        console.error(`Failed to close #${id}`, e);
      }
    }
    
    setIsBulkProcessing(false);
    loadIssues();
  };

  // --- Redundancy Card Actions ---

  const executeConsolidate = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = createCandidates.filter(c => selectedCreateIds.has(c._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        await createIssue(repoName, token, {
          title: item.title,
          body: item.body + `\n\n*Consolidates issues: ${item.replacesIssueNumbers.map(n => `#${n}`).join(', ')}*`,
          labels: item.labels
        });
        successIds.push(item._id);
      } catch (e) {
        console.error(e);
      }
    }

    setCreateCandidates(prev => prev.filter(c => !successIds.includes(c._id)));
    setSelectedCreateIds(prev => {
       const next = new Set(prev);
       successIds.forEach(id => next.delete(id));
       return next;
    });
    setActionProcessing(false);
  };

  const executePrune = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = closeCandidates.filter(c => selectedCloseIds.has(c._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        successIds.push(item._id);
      } catch (e) {
        console.error(e);
      }
    }

    setCloseCandidates(prev => prev.filter(c => !successIds.includes(c._id)));
    setSelectedCloseIds(prev => {
       const next = new Set(prev);
       successIds.forEach(id => next.delete(id));
       return next;
    });
    setActionProcessing(false);
  };

  const toggleRedundancySelection = (setIds: Set<string>, setFunction: (s: Set<string>) => void, id: string) => {
     const next = new Set(setIds);
     if (next.has(id)) next.delete(id);
     else next.add(id);
     setFunction(next);
  };

  const toggleRedundancyAll = (ids: string[], currentSet: Set<string>, setFunction: (s: Set<string>) => void) => {
     if (currentSet.size === ids.length && ids.length > 0) setFunction(new Set());
     else setFunction(new Set(ids));
  };

  // --- Triage Actions ---

  const executeTriageUpdates = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = triageActions.filter(a => selectedTriageIds.has(a._id));
    const successIds: string[] = [];

    for (const item of selected) {
      try {
        await addLabels(repoName, token, item.issueNumber, item.suggestedLabels);
        successIds.push(item._id);
      } catch (e) {
        console.error(e);
      }
    }

    setTriageActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedTriageIds(prev => {
      const next = new Set(prev);
      successIds.forEach(id => next.delete(id));
      return next;
    });
    setActionProcessing(false);
  };

  const toggleTriageSelection = (id: string) => {
    const next = new Set(selectedTriageIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTriageIds(next);
  };

  const toggleTriageAll = () => {
    if (selectedTriageIds.size === triageActions.length && triageActions.length > 0) setSelectedTriageIds(new Set());
    else setSelectedTriageIds(new Set(triageActions.map(a => a._id)));
  };


  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Issue Analysis</h2>
        <p className="text-slate-400">Detect duplicates, organize backlog, and prioritize work.</p>
      </div>
      
      {/* 1. REDUNDANCY ANALYSIS CARD */}
      <AnalysisCard 
        title="Redundancy Detector"
        description="Identify duplicate issues and consolidation opportunities."
        status={redundancyStatus}
        result={redundancyData?.summary || null}
        onAnalyze={handleRedundancyCheck}
        repoName={repoName}
      />
      
      {/* Redundancy Action Area */}
      {(createCandidates.length > 0 || closeCandidates.length > 0) && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 mb-8">
           <div className="flex border-b border-slate-700">
             <button 
               onClick={() => setActiveRedundancyTab('consolidate')}
               className={clsx(
                 "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
                 activeRedundancyTab === 'consolidate' ? "border-primary text-primary bg-primary/5" : "border-transparent text-slate-400 hover:text-white"
               )}
             >
               Consolidate ({createCandidates.length})
             </button>
             <button 
               onClick={() => setActiveRedundancyTab('prune')}
               className={clsx(
                 "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
                 activeRedundancyTab === 'prune' ? "border-red-500 text-red-500 bg-red-500/5" : "border-transparent text-slate-400 hover:text-white"
               )}
             >
               Prune Duplicates ({closeCandidates.length})
             </button>
           </div>
           
           <div className="p-4 bg-slate-900/30">
             {activeRedundancyTab === 'consolidate' && (
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <input 
                           type="checkbox"
                           checked={createCandidates.length > 0 && selectedCreateIds.size === createCandidates.length}
                           onChange={() => toggleRedundancyAll(createCandidates.map(c => c._id), selectedCreateIds, setSelectedCreateIds)}
                           className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer"
                        />
                        <span className="text-sm text-slate-400">Select All</span>
                      </div>
                      <button 
                        onClick={executeConsolidate}
                        disabled={selectedCreateIds.size === 0 || actionProcessing}
                        className={clsx(
                          "px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2",
                          selectedCreateIds.size > 0 ? "bg-primary text-white hover:bg-blue-600" : "bg-slate-700 text-slate-500 cursor-not-allowed"
                        )}
                      >
                         {actionProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                         Create Issues
                      </button>
                   </div>
                   <div className="grid gap-3">
                     {createCandidates.map(item => (
                       <div key={item._id} className={clsx("p-4 border rounded-lg transition-colors", selectedCreateIds.has(item._id) ? "bg-blue-900/20 border-blue-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <div className="flex gap-3">
                             <input 
                                type="checkbox"
                                checked={selectedCreateIds.has(item._id)}
                                onChange={() => toggleRedundancySelection(selectedCreateIds, setSelectedCreateIds, item._id)}
                                className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer shrink-0"
                             />
                             <div>
                               <h4 className="font-bold text-white">{item.title}</h4>
                               <p className="text-sm text-slate-400 mt-1">{item.reason}</p>
                               <div className="flex flex-wrap gap-2 mt-2">
                                 {item.replacesIssueNumbers.map(n => (
                                   <span key={n} className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Replaces #{n}</span>
                                 ))}
                               </div>
                             </div>
                          </div>
                       </div>
                     ))}
                   </div>
                </div>
             )}

             {activeRedundancyTab === 'prune' && (
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <input 
                           type="checkbox"
                           checked={closeCandidates.length > 0 && selectedCloseIds.size === closeCandidates.length}
                           onChange={() => toggleRedundancyAll(closeCandidates.map(c => c._id), selectedCloseIds, setSelectedCloseIds)}
                           className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-0 cursor-pointer"
                        />
                        <span className="text-sm text-slate-400">Select All</span>
                      </div>
                      <button 
                        onClick={executePrune}
                        disabled={selectedCloseIds.size === 0 || actionProcessing}
                        className={clsx(
                          "px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2",
                          selectedCloseIds.size > 0 ? "bg-red-600 text-white hover:bg-red-500" : "bg-slate-700 text-slate-500 cursor-not-allowed"
                        )}
                      >
                         {actionProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                         Close Duplicates
                      </button>
                   </div>
                   <div className="grid gap-3">
                     {closeCandidates.map(item => (
                       <div key={item._id} className={clsx("p-4 border rounded-lg transition-colors", selectedCloseIds.has(item._id) ? "bg-red-900/10 border-red-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <div className="flex gap-3">
                             <input 
                                type="checkbox"
                                checked={selectedCloseIds.has(item._id)}
                                onChange={() => toggleRedundancySelection(selectedCloseIds, setSelectedCloseIds, item._id)}
                                className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-0 cursor-pointer shrink-0"
                             />
                             <div>
                               <div className="flex items-center gap-2">
                                 <span className="text-sm font-mono text-slate-500">#{item.issueNumber}</span>
                                 <span className="text-red-400 text-sm font-medium">Duplicate / Stale</span>
                               </div>
                               <p className="text-sm text-slate-300 mt-1">{item.reason}</p>
                             </div>
                          </div>
                       </div>
                     ))}
                   </div>
                </div>
             )}
           </div>
        </div>
      )}

      {/* 2. TRIAGE ANALYSIS CARD */}
      <AnalysisCard 
        title="Smart Triage"
        description="Auto-label issues by priority, effort, and category."
        status={triageStatus}
        result={triageData?.report || null}
        onAnalyze={handleTriageReport}
        repoName={repoName}
      />

      {/* Triage Action Area */}
      {triageActions.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 mb-8">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
            <div className="flex items-center gap-4">
               <h3 className="font-semibold text-white">Recommended Label Updates ({triageActions.length})</h3>
               <div className="flex items-center gap-2">
                  <input 
                    type="checkbox"
                    checked={triageActions.length > 0 && selectedTriageIds.size === triageActions.length}
                    onChange={toggleTriageAll}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs text-slate-400">Select All</span>
               </div>
            </div>
            <button 
              onClick={executeTriageUpdates}
              disabled={selectedTriageIds.size === 0 || actionProcessing}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors",
                selectedTriageIds.size > 0 
                  ? "bg-green-600 text-white hover:bg-green-500 shadow-lg shadow-green-900/20" 
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              {actionProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Tag className="w-4 h-4"/>}
              Apply Labels
            </button>
          </div>
          
          <div className="divide-y divide-slate-700 max-h-[500px] overflow-y-auto">
             {triageActions.map(action => (
               <div key={action._id} className={clsx(
                 "p-4 flex gap-4 transition-colors",
                 selectedTriageIds.has(action._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20"
               )}>
                 <div className="pt-1">
                    <input 
                      type="checkbox"
                      checked={selectedTriageIds.has(action._id)}
                      onChange={() => toggleTriageSelection(action._id)}
                      className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary focus:ring-0 cursor-pointer"
                    />
                 </div>
                 <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-slate-500 text-sm">#{action.issueNumber}</span>
                      <span className="text-white font-medium truncate">{action.title}</span>
                    </div>
                    
                    {/* Metrics Badges */}
                    <div className="flex flex-wrap gap-2 my-2">
                       <span className={clsx(
                         "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border",
                         action.priority === 'High' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                         action.priority === 'Medium' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                         "bg-blue-500/10 text-blue-400 border-blue-500/20"
                       )}>
                         <AlertCircle className="w-3 h-3" /> {action.priority} Priority
                       </span>

                       <span className={clsx(
                         "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border",
                         action.effort === 'Large' ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                         action.effort === 'Medium' ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" :
                         "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                       )}>
                         <Gauge className="w-3 h-3" /> {action.effort} Effort
                       </span>

                       <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-700/50 text-slate-300 border-slate-600">
                         <Box className="w-3 h-3" /> {action.category}
                       </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                       <span className="text-xs text-slate-500">Adding Labels:</span>
                       {action.suggestedLabels.map(l => (
                         <span key={l} className="text-xs bg-blue-900/30 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/20 font-mono">
                           {l}
                         </span>
                       ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2 italic">{action.reason}</p>
                 </div>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* 3. MAIN ISSUE LIST (BULK ACTIONS) */}
      <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
             <h3 className="font-semibold text-white">Open Issues ({issues.length})</h3>
             {selectedIssueIds.size > 0 && (
               <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                  <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-full">{selectedIssueIds.size} Selected</span>
                  <button 
                    onClick={handleBulkClose}
                    disabled={isBulkProcessing}
                    className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-3 py-1 rounded border border-red-800 flex items-center gap-1 transition-colors"
                  >
                    {isBulkProcessing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Trash2 className="w-3 h-3" />}
                    Close Selected
                  </button>
               </div>
             )}
          </div>
          
          <button 
            onClick={handleAutoSelect}
            disabled={autoSelectLoading}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded flex items-center gap-2 transition-colors border border-slate-600"
          >
            {autoSelectLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-yellow-400" />}
            Auto-Select Redundant (AI)
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading issues...</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {issues.map(issue => (
              <div key={issue.id} className={clsx("p-4 transition-colors hover:bg-slate-800/30", selectedIssueIds.has(issue.number) && "bg-blue-900/10")}>
                <div className="flex items-start gap-4">
                  <div className="pt-1">
                    <input 
                      type="checkbox"
                      checked={selectedIssueIds.has(issue.number)}
                      onChange={() => toggleSelection(issue.number)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-primary focus:ring-offset-0 focus:ring-0 cursor-pointer"
                    />
                  </div>
                  <div className="pt-1">
                    <AlertCircle className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-4">
                      <h4 className="text-base font-medium text-slate-200 truncate">
                        <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                          {issue.title}
                        </a>
                      </h4>
                      <span className="text-sm font-mono text-slate-500 whitespace-nowrap">#{issue.number}</span>
                    </div>
                    
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                       <span>Opened by {issue.user.login} on {new Date(issue.created_at).toLocaleDateString()}</span>
                       {issue.labels.length > 0 && <span className="text-slate-600">|</span>}
                       {issue.labels.map(label => (
                         <span 
                           key={label.id} 
                           className="px-1.5 py-0.5 rounded font-medium"
                           style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}`, border: `1px solid #${label.color}40` }}
                         >
                           {label.name}
                         </span>
                       ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Issues;
