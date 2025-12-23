
import React, { useState, useEffect } from 'react';
import { fetchIssues, updateIssue, createIssue, addLabels } from '../services/githubService';
import { analyzeIssueRedundancy, generateTriageReport, identifyRedundantCandidates, analyzeIssueQuality } from '../services/geminiService';
import { listSessions } from '../services/julesService';
import { GithubIssue, RedundancyAnalysisResult, TriageAnalysisResult, TriageAction, JulesSession, IssueImprovementRecommendation, IssueStalenessRecommendation } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { AlertCircle, Tag, Sparkles, Trash2, Plus, Box, Gauge, Loader2, TerminalSquare, Eye, Settings, Wrench, XCircle, FileText, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

interface IssuesProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

// Local types for UI interaction
type ConsolidatedIssueUI = RedundancyAnalysisResult['consolidatedIssues'][0] & { _id: string };
type RedundantIssueUI = RedundancyAnalysisResult['redundantIssues'][0] & { _id: string };
type TriageActionUI = TriageAction & { _id: string };
type ImprovementUI = IssueImprovementRecommendation & { _id: string; expanded?: boolean };
type ClosureUI = IssueStalenessRecommendation & { _id: string };

const Issues: React.FC<IssuesProps> = ({ repoName, token, julesApiKey }) => {
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  // Selection State (Main List)
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<number>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [autoSelectLoading, setAutoSelectLoading] = useState(false);
  
  // Hooks for Analysis (Cached)
  const redundancyAnalysis = useGeminiAnalysis(analyzeIssueRedundancy, 'redundancy_report');
  const triageAnalysis = useGeminiAnalysis(generateTriageReport, 'triage_report');
  // Pass repo and token context to quality analysis
  const qualityAnalysis = useGeminiAnalysis((issuesList) => analyzeIssueQuality(issuesList, repoName, token), 'quality_report');
  
  // Redundancy Action State
  const [createCandidates, setCreateCandidates] = useState<ConsolidatedIssueUI[]>([]);
  const [closeCandidates, setCloseCandidates] = useState<RedundantIssueUI[]>([]);
  const [selectedCreateIds, setSelectedCreateIds] = useState<Set<string>>(new Set());
  const [selectedCloseIds, setSelectedCloseIds] = useState<Set<string>>(new Set());
  const [activeRedundancyTab, setActiveRedundancyTab] = useState<'consolidate' | 'prune'>('consolidate');

  // Triage State
  const [triageActions, setTriageActions] = useState<TriageActionUI[]>([]);
  const [selectedTriageIds, setSelectedTriageIds] = useState<Set<string>>(new Set());

  // Quality State
  const [qualityImprovements, setQualityImprovements] = useState<ImprovementUI[]>([]);
  const [qualityClosures, setQualityClosures] = useState<ClosureUI[]>([]);
  const [selectedImproveIds, setSelectedImproveIds] = useState<Set<string>>(new Set());
  const [selectedQualityCloseIds, setSelectedQualityCloseIds] = useState<Set<string>>(new Set());
  const [activeQualityTab, setActiveQualityTab] = useState<'improve' | 'close'>('improve');
  const [actionProcessing, setActionProcessing] = useState(false);

  // Jules Sessions State
  const [julesSessions, setJulesSessions] = useState<JulesSession[]>([]);

  useEffect(() => {
    if (repoName && token) {
      loadIssues();
    } else {
      setLoading(false);
    }
  }, [repoName, token]);

  useEffect(() => {
    if (julesApiKey) {
      listSessions(julesApiKey).then(setJulesSessions).catch(console.error);
    }
  }, [julesApiKey]);

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
    setCreateCandidates([]);
    setCloseCandidates([]);
    await redundancyAnalysis.run(issues);
  };

  // Sync redundancy results to local state when analysis completes
  useEffect(() => {
    if (redundancyAnalysis.result) {
      setCreateCandidates(redundancyAnalysis.result.consolidatedIssues.map(i => ({...i, _id: Math.random().toString(36).substr(2,9)})));
      setCloseCandidates(redundancyAnalysis.result.redundantIssues.map(i => ({...i, _id: Math.random().toString(36).substr(2,9)})));
    }
  }, [redundancyAnalysis.result]);

  const handleTriageReport = async () => {
    setTriageActions([]);
    await triageAnalysis.run(issues);
  };

  // Sync triage results to local state
  useEffect(() => {
    if (triageAnalysis.result) {
      setTriageActions(triageAnalysis.result.actions.map(a => ({...a, _id: Math.random().toString(36).substr(2,9)})));
      setSelectedTriageIds(new Set());
    }
  }, [triageAnalysis.result]);

  const handleQualityCheck = async () => {
    setQualityImprovements([]);
    setQualityClosures([]);
    await qualityAnalysis.run(issues);
  };

  useEffect(() => {
    if (qualityAnalysis.result) {
      setQualityImprovements(qualityAnalysis.result.improvements.map(i => ({...i, _id: Math.random().toString(36).substr(2,9), expanded: false })));
      setQualityClosures(qualityAnalysis.result.closures.map(i => ({...i, _id: Math.random().toString(36).substr(2,9) })));
    }
  }, [qualityAnalysis.result]);

  // --- Bulk Action Handlers (Main List) ---
  const toggleSelection = (id: number) => {
    const newSelection = new Set(selectedIssueIds);
    if (newSelection.has(id)) newSelection.delete(id);
    else newSelection.add(id);
    setSelectedIssueIds(newSelection);
  };

  const toggleSelectAllIssues = () => {
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
          if (!isNaN(id) && issues.find(i => i.number === id)) newSelection.add(id);
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
    if (!token) return alert("GitHub Token required.");
    if (!window.confirm(`Close ${selectedIssueIds.size} issues?`)) return;

    setIsBulkProcessing(true);
    const ids = Array.from(selectedIssueIds);
    const errors: string[] = [];
    
    for (const id of ids) {
      try {
        await updateIssue(repoName, token, id as number, { state: 'closed' });
      } catch (e: any) {
        console.error(e);
        errors.push(`Issue #${id}: ${e.message}`);
      }
    }
    
    if (errors.length > 0) {
      alert(`Failed to close ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setIsBulkProcessing(false);
    loadIssues();
  };

  const getActiveSessionForIssue = (issueNumber: number) => {
    return julesSessions.find(s => {
      // Must be in an active state
      const isActive = ['RUNNING', 'PENDING', 'IN_PROGRESS', 'AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'].includes(s.state);
      if (!isActive) return false;

      // Check title for issue number
      const titleHasId = s.title?.includes(`#${issueNumber}`);
      
      // Check branch for issue number pattern (issue-123 or issue/123)
      const branch = s.sourceContext?.githubRepoContext?.startingBranch || '';
      const branchHasId = branch.includes(`issue-${issueNumber}`) || branch.includes(`issue/${issueNumber}`);

      return titleHasId || branchHasId;
    });
  };

  const handleJulesClick = (issue: GithubIssue) => {
    const activeSession = getActiveSessionForIssue(issue.number);
    if (activeSession) {
      // View existing
      navigate('/sessions', { state: { viewSessionName: activeSession.name } });
    } else {
      // Create new
      navigate('/sessions', { 
        state: { 
          createFromIssue: { 
            title: issue.title, 
            number: issue.number, 
            body: issue.body 
          } 
        } 
      });
    }
  };

  // --- Redundancy Card Actions ---
  const executeConsolidate = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = createCandidates.filter(c => selectedCreateIds.has(c._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        await createIssue(repoName, token, {
          title: item.title,
          body: item.body + `\n\n*Consolidates issues: ${item.replacesIssueNumbers.map(n => `#${n}`).join(', ')}*`,
          labels: item.labels
        });
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e);
        errors.push(`"${item.title}": ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to create ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setCreateCandidates(prev => prev.filter(c => !successIds.includes(c._id)));
    setSelectedCreateIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setActionProcessing(false);
  };

  const executePrune = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = closeCandidates.filter(c => selectedCloseIds.has(c._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e);
        errors.push(`Issue #${item.issueNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to close ${errors.length} duplicates:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setCloseCandidates(prev => prev.filter(c => !successIds.includes(c._id)));
    setSelectedCloseIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setActionProcessing(false);
  };

  // --- Triage Actions ---
  const executeTriageUpdates = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = triageActions.filter(a => selectedTriageIds.has(a._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        await addLabels(repoName, token, item.issueNumber, item.suggestedLabels);
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e);
        errors.push(`Issue #${item.issueNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to update ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setTriageActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedTriageIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setActionProcessing(false);
  };

  // --- Quality Actions ---
  const executeImprovements = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = qualityImprovements.filter(i => selectedImproveIds.has(i._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        // Direct update of Title and Body
        await updateIssue(repoName, token, item.issueNumber, { 
          title: item.suggestedTitle,
          body: item.suggestedBody
        });
        successIds.push(item._id);
      } catch (e: any) {
        console.error(e);
        errors.push(`Issue #${item.issueNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to improve ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setQualityImprovements(prev => prev.filter(i => !successIds.includes(i._id)));
    setSelectedImproveIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setActionProcessing(false);
  };

  const handleUpdateImprovement = (id: string, field: 'suggestedTitle' | 'suggestedBody', value: string) => {
    setQualityImprovements(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  };

  const executeQualityClosures = async () => {
    if (!token) return alert("GitHub token required.");
    setActionProcessing(true);
    const selected = qualityClosures.filter(c => selectedQualityCloseIds.has(c._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        await updateIssue(repoName, token, item.issueNumber, { state: 'closed' });
        successIds.push(item._id);
      } catch (e: any) {
        console.error(e);
        errors.push(`Issue #${item.issueNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to close ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setQualityClosures(prev => prev.filter(c => !successIds.includes(c._id)));
    setSelectedQualityCloseIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setActionProcessing(false);
  };

  const toggleSet = (setIds: Set<string>, setFunction: (s: Set<string>) => void, id: string) => {
    const next = new Set(setIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFunction(next);
  };

  // Generic toggle all for analysis results
  const toggleAllInSet = (items: { _id: string }[], setIds: Set<string>, setFunction: (s: Set<string>) => void) => {
    if (setIds.size === items.length) {
      setFunction(new Set());
    } else {
      setFunction(new Set(items.map(i => i._id)));
    }
  };

  const toggleExpandImprovement = (id: string) => {
    setQualityImprovements(prev => prev.map(i => i._id === id ? { ...i, expanded: !i.expanded } : i));
  };

  if (!token) {
     return (
        <div className="flex flex-col items-center justify-center h-96 text-center">
           <AlertCircle className="w-12 h-12 text-slate-600 mb-4" />
           <h2 className="text-xl font-bold text-white mb-2">GitHub Token Required</h2>
           <p className="text-slate-400 max-w-sm">Please configure your GitHub Token in settings to analyze issues.</p>
        </div>
     );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Issue Analysis</h2>
        <p className="text-slate-400">Detect duplicates, organize backlog, and prioritize work.</p>
      </div>
      
      {/* 1. REDUNDANCY ANALYSIS */}
      <AnalysisCard 
        title="Redundancy Detector"
        description="Identify duplicate issues and consolidation opportunities."
        status={redundancyAnalysis.status}
        result={redundancyAnalysis.result?.summary || null}
        onAnalyze={handleRedundancyCheck}
        repoName={repoName}
      />
      
      {/* Redundancy Actions */}
      {(createCandidates.length > 0 || closeCandidates.length > 0) && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden mb-8">
           <div className="flex border-b border-slate-700">
             <button onClick={() => setActiveRedundancyTab('consolidate')} className={clsx("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", activeRedundancyTab === 'consolidate' ? "border-primary text-primary bg-primary/5" : "border-transparent text-slate-400 hover:text-white")}>
               Consolidate ({createCandidates.length})
             </button>
             <button onClick={() => setActiveRedundancyTab('prune')} className={clsx("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", activeRedundancyTab === 'prune' ? "border-red-500 text-red-500 bg-red-500/5" : "border-transparent text-slate-400 hover:text-white")}>
               Prune Duplicates ({closeCandidates.length})
             </button>
           </div>
           
           <div className="p-4 bg-slate-900/30">
             {activeRedundancyTab === 'consolidate' && (
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                         <input 
                           type="checkbox" 
                           checked={createCandidates.length > 0 && selectedCreateIds.size === createCandidates.length}
                           onChange={() => toggleAllInSet(createCandidates, selectedCreateIds, setSelectedCreateIds)}
                           className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                           title="Select All"
                         />
                         <div className="text-sm text-slate-400">{selectedCreateIds.size} selected</div>
                      </div>
                      <Button variant="primary" size="sm" onClick={executeConsolidate} disabled={selectedCreateIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={Plus}>Create Issues</Button>
                   </div>
                   <div className="grid gap-3">
                     {createCandidates.map(item => (
                       <div key={item._id} className={clsx("p-4 border rounded-lg transition-colors flex gap-3", selectedCreateIds.has(item._id) ? "bg-blue-900/20 border-blue-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <input type="checkbox" checked={selectedCreateIds.has(item._id)} onChange={() => toggleSet(selectedCreateIds, setSelectedCreateIds, item._id)} className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer shrink-0" />
                          <div>
                            <h4 className="font-bold text-white">{item.title}</h4>
                            <p className="text-sm text-slate-400 mt-1">{item.reason}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {item.replacesIssueNumbers.map(n => <Badge key={n} variant="gray">Replaces #{n}</Badge>)}
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
                      <div className="flex items-center gap-3">
                         <input 
                           type="checkbox" 
                           checked={closeCandidates.length > 0 && selectedCloseIds.size === closeCandidates.length}
                           onChange={() => toggleAllInSet(closeCandidates, selectedCloseIds, setSelectedCloseIds)}
                           className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer"
                           title="Select All"
                         />
                         <div className="text-sm text-slate-400">{selectedCloseIds.size} selected</div>
                      </div>
                      <Button variant="danger" size="sm" onClick={executePrune} disabled={selectedCloseIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={Trash2}>Close Duplicates</Button>
                   </div>
                   <div className="grid gap-3">
                     {closeCandidates.map(item => (
                       <div key={item._id} className={clsx("p-4 border rounded-lg transition-colors flex gap-3", selectedCloseIds.has(item._id) ? "bg-red-900/10 border-red-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <input type="checkbox" checked={selectedCloseIds.has(item._id)} onChange={() => toggleSet(selectedCloseIds, setSelectedCloseIds, item._id)} className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer shrink-0" />
                          <div>
                             <div className="flex items-center gap-2">
                               <span className="text-sm font-mono text-slate-500">#{item.issueNumber}</span>
                               <span className="text-red-400 text-sm font-medium">Duplicate</span>
                             </div>
                             <p className="text-sm text-slate-300 mt-1">{item.reason}</p>
                          </div>
                       </div>
                     ))}
                   </div>
                </div>
             )}
           </div>
        </div>
      )}

      {/* 2. QUALITY ANALYSIS */}
      <AnalysisCard 
        title="Content Quality Audit"
        description="Expand vague issues and close stale or irrelevant ones."
        status={qualityAnalysis.status}
        result={qualityAnalysis.result?.summary || null}
        onAnalyze={handleQualityCheck}
        repoName={repoName}
      />

      {/* Quality Actions */}
      {(qualityImprovements.length > 0 || qualityClosures.length > 0) && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden mb-8">
           <div className="flex border-b border-slate-700">
             <button onClick={() => setActiveQualityTab('improve')} className={clsx("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", activeQualityTab === 'improve' ? "border-green-500 text-green-500 bg-green-500/5" : "border-transparent text-slate-400 hover:text-white")}>
               Expand & Refine ({qualityImprovements.length})
             </button>
             <button onClick={() => setActiveQualityTab('close')} className={clsx("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", activeQualityTab === 'close' ? "border-red-500 text-red-500 bg-red-500/5" : "border-transparent text-slate-400 hover:text-white")}>
               Prune Stale ({qualityClosures.length})
             </button>
           </div>
           
           <div className="p-4 bg-slate-900/30">
             {activeQualityTab === 'improve' && (
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                         <input 
                           type="checkbox" 
                           checked={qualityImprovements.length > 0 && selectedImproveIds.size === qualityImprovements.length}
                           onChange={() => toggleAllInSet(qualityImprovements, selectedImproveIds, setSelectedImproveIds)}
                           className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                           title="Select All"
                         />
                         <div className="text-sm text-slate-400">{selectedImproveIds.size} selected</div>
                      </div>
                      <Button variant="success" size="sm" onClick={executeImprovements} disabled={selectedImproveIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={Wrench}>Apply Updates</Button>
                   </div>
                   <div className="grid gap-3">
                     {qualityImprovements.map(item => (
                       <div key={item._id} className={clsx("border rounded-lg transition-colors overflow-hidden", selectedImproveIds.has(item._id) ? "bg-green-900/10 border-green-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <div className="p-4 flex gap-3">
                            <input type="checkbox" checked={selectedImproveIds.has(item._id)} onChange={() => toggleSet(selectedImproveIds, setSelectedImproveIds, item._id)} className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-green-500 cursor-pointer shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start">
                                <div className="flex-1 mr-4">
                                  {/* Header: Original Context */}
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-mono text-slate-500 text-xs">#{item.issueNumber}</span>
                                    <span className="text-xs text-slate-500 truncate max-w-[200px]" title={item.title}>Current: {item.title}</span>
                                  </div>

                                  {/* Editable Title */}
                                  <div className="mb-2">
                                    <label className="text-[10px] uppercase font-bold text-green-500 mb-1 block">New Title</label>
                                    <input 
                                      type="text" 
                                      value={item.suggestedTitle}
                                      onChange={(e) => handleUpdateImprovement(item._id, 'suggestedTitle', e.target.value)}
                                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-green-500 focus:outline-none placeholder-slate-600"
                                      placeholder="Improve title..."
                                    />
                                  </div>
                                  
                                  {/* Reason / Preview Toggle */}
                                  {!item.expanded && (
                                     <button onClick={() => toggleExpandImprovement(item._id)} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 mt-1 group">
                                       <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] border border-slate-700 group-hover:border-slate-500">Reason: {item.reason}</span>
                                       <span className="text-[10px] opacity-50 ml-1">(Click arrow to edit body)</span>
                                     </button>
                                  )}
                                </div>
                                
                                <button onClick={() => toggleExpandImprovement(item._id)} className="text-slate-500 hover:text-white p-1 hover:bg-slate-700 rounded">
                                  {item.expanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          {item.expanded && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="text-[10px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-2">
                                <Edit3 className="w-3 h-3"/> New Description Body (Markdown)
                              </div>
                              <textarea 
                                value={item.suggestedBody}
                                onChange={(e) => handleUpdateImprovement(item._id, 'suggestedBody', e.target.value)}
                                className="w-full h-48 bg-slate-900 p-3 rounded border border-slate-700 text-xs font-mono text-slate-300 focus:border-green-500 focus:outline-none resize-y"
                                placeholder="Enter updated description..."
                              />
                              <p className="text-[10px] text-slate-500 mt-2">AI Reason: {item.reason}</p>
                            </div>
                          )}
                       </div>
                     ))}
                   </div>
                </div>
             )}

             {activeQualityTab === 'close' && (
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                         <input 
                           type="checkbox" 
                           checked={qualityClosures.length > 0 && selectedQualityCloseIds.size === qualityClosures.length}
                           onChange={() => toggleAllInSet(qualityClosures, selectedQualityCloseIds, setSelectedQualityCloseIds)}
                           className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer"
                           title="Select All"
                         />
                         <div className="text-sm text-slate-400">{selectedQualityCloseIds.size} selected</div>
                      </div>
                      <Button variant="danger" size="sm" onClick={executeQualityClosures} disabled={selectedQualityCloseIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={XCircle}>Close Irrelevant</Button>
                   </div>
                   <div className="grid gap-3">
                     {qualityClosures.map(item => (
                       <div key={item._id} className={clsx("p-4 border rounded-lg transition-colors flex gap-3", selectedQualityCloseIds.has(item._id) ? "bg-red-900/10 border-red-500/50" : "bg-slate-800/50 border-slate-700")}>
                          <input type="checkbox" checked={selectedQualityCloseIds.has(item._id)} onChange={() => toggleSet(selectedQualityCloseIds, setSelectedQualityCloseIds, item._id)} className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-red-500 cursor-pointer shrink-0" />
                          <div>
                             <div className="flex items-center gap-2">
                               <span className="text-sm font-mono text-slate-500">#{item.issueNumber}</span>
                               <span className="text-white font-medium">{item.title}</span>
                             </div>
                             <p className="text-sm text-slate-300 mt-1">{item.reason}</p>
                          </div>
                       </div>
                     ))}
                   </div>
                </div>
             )}
           </div>
        </div>
      )}

      {/* 3. TRIAGE ANALYSIS */}
      <AnalysisCard 
        title="Smart Triage"
        description="Auto-label issues by priority, effort, and category."
        status={triageAnalysis.status}
        result={triageAnalysis.result?.report || null}
        onAnalyze={handleTriageReport}
        repoName={repoName}
      />

      {/* Triage Actions */}
      {triageActions.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden mb-8">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
            <div className="flex items-center gap-3">
               <input 
                 type="checkbox" 
                 checked={triageActions.length > 0 && selectedTriageIds.size === triageActions.length}
                 onChange={() => toggleAllInSet(triageActions, selectedTriageIds, setSelectedTriageIds)}
                 className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                 title="Select All"
               />
               <h3 className="font-semibold text-white">Recommended Updates ({triageActions.length})</h3>
            </div>
            <Button variant="success" size="sm" onClick={executeTriageUpdates} disabled={selectedTriageIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={Tag}>Apply Labels</Button>
          </div>
          
          <div className="divide-y divide-slate-700 max-h-[500px] overflow-y-auto">
             {triageActions.map(action => (
               <div key={action._id} className={clsx("p-4 flex gap-4", selectedTriageIds.has(action._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                 <div className="pt-1">
                    <input type="checkbox" checked={selectedTriageIds.has(action._id)} onChange={() => toggleSet(selectedTriageIds, setSelectedTriageIds, action._id)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                 </div>
                 <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-slate-500 text-sm">#{action.issueNumber}</span>
                      <span className="text-white font-medium truncate">{action.title}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 my-2">
                       <Badge variant={action.priority === 'High' ? 'red' : action.priority === 'Medium' ? 'yellow' : 'blue'} icon={AlertCircle}>{action.priority} Priority</Badge>
                       <Badge variant="purple" icon={Gauge}>{action.effort} Effort</Badge>
                       <Badge variant="gray" icon={Box}>{action.category}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                       <span className="text-xs text-slate-500">Adding:</span>
                       {action.suggestedLabels.map(l => <Badge key={l} variant="blue" className="font-mono">{l}</Badge>)}
                    </div>
                 </div>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* 4. MAIN ISSUE LIST */}
      <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-3">
               <input 
                 type="checkbox" 
                 checked={issues.length > 0 && selectedIssueIds.size === issues.length} 
                 onChange={toggleSelectAllIssues}
                 className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                 title="Select All Issues"
               />
               <h3 className="font-semibold text-white">Open Issues ({issues.length})</h3>
             </div>
             {selectedIssueIds.size > 0 && (
               <div className="flex items-center gap-2 animate-in fade-in ml-2">
                  <Badge variant="blue">{selectedIssueIds.size} Selected</Badge>
                  <Button variant="danger" size="sm" onClick={handleBulkClose} disabled={isBulkProcessing} isLoading={isBulkProcessing} icon={Trash2}>Close</Button>
               </div>
             )}
          </div>
          <Button variant="secondary" size="sm" onClick={handleAutoSelect} disabled={autoSelectLoading} isLoading={autoSelectLoading} icon={Sparkles}>Auto-Select (AI)</Button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500"><Loader2 className="w-8 h-8 mx-auto animate-spin mb-2"/>Loading issues...</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {issues.map(issue => {
              const activeSession = getActiveSessionForIssue(issue.number);
              return (
                <div key={issue.id} className={clsx("p-4 hover:bg-slate-800/30 group", selectedIssueIds.has(issue.number) && "bg-blue-900/10")}>
                  <div className="flex items-start gap-4">
                    <input type="checkbox" checked={selectedIssueIds.has(issue.number)} onChange={() => toggleSelection(issue.number)} className="w-4 h-4 mt-1 rounded border-slate-600 bg-slate-700 text-primary cursor-pointer" />
                    <AlertCircle className="w-5 h-5 text-green-500 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-4">
                        <h4 className="text-base font-medium text-slate-200 truncate">
                          <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{issue.title}</a>
                        </h4>
                        <div className="flex items-center gap-2">
                          {julesApiKey && (
                            activeSession ? (
                              <button 
                                onClick={() => handleJulesClick(issue)}
                                className="px-2 py-1 bg-green-900/30 text-green-400 border border-green-800/50 rounded hover:bg-green-900/50 flex items-center gap-1.5 text-xs font-medium animate-pulse"
                                title="View active session"
                              >
                                <Loader2 className="w-3 h-3 animate-spin" /> View Session
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleJulesClick(issue)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500 hover:text-white flex items-center gap-1 text-xs"
                                title="Start Jules Session for this issue"
                              >
                                <TerminalSquare className="w-3 h-3" /> Work with Jules
                              </button>
                            )
                          )}
                          <span className="text-sm font-mono text-slate-500">#{issue.number}</span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                         <span>{issue.user.login}</span>
                         {issue.labels.map(l => <span key={l.id} className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}`, border: `1px solid #${l.color}40` }}>{l.name}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Issues;
