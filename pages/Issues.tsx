
import React, { useState, useEffect, useMemo } from 'react';
import { fetchIssues, updateIssue, createIssue, addLabels, addComment, fetchRepoTemplates } from '../services/githubService';
import { analyzeBacklogMaintenance } from '../services/geminiService';
import { GithubIssue, BacklogTransformation } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { 
  AlertCircle, 
  Tag, 
  Sparkles, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  Wrench, 
  ChevronDown, 
  ChevronUp, 
  Layers, 
  Play,
  Rocket,
  RefreshCw,
  FileEdit,
  ArrowRight
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface IssuesProps { repoName: string; token: string; julesApiKey?: string; }

type TransformationUI = BacklogTransformation & { 
  _id: string; 
  status: 'idle' | 'processing' | 'success' | 'error';
  expanded: boolean;
};

const Issues: React.FC<IssuesProps> = ({ repoName, token }) => {
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [transformations, setTransformations] = useState<TransformationUI[]>([]);
  const [selectedTransformIds, setSelectedTransformIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const maintenanceAnalysis = useGeminiAnalysis(analyzeBacklogMaintenance, 'backlog_maintenance_v3');

  useEffect(() => { if (repoName && token) loadIssues(); }, [repoName, token]);

  const loadIssues = async () => {
    setLoading(true);
    try {
      const data = await fetchIssues(repoName, token, 'open');
      setIssues(data);
    } catch (e) {} finally { setLoading(false); }
  };

  useEffect(() => {
    if (maintenanceAnalysis.result?.transformations) {
      setTransformations(maintenanceAnalysis.result.transformations.map(t => ({
        ...t,
        _id: Math.random().toString(36).substr(2, 9),
        status: 'idle',
        expanded: false
      })));
    }
  }, [maintenanceAnalysis.result]);

  const runAudit = async () => {
    if (!token) return;
    try {
      const templates = await fetchRepoTemplates(repoName, token);
      await maintenanceAnalysis.run(issues, { templates });
    } catch (e: any) {
      alert("Audit failed: " + e.message);
    }
  };

  const handleRefineSingle = async (transform: TransformationUI) => {
    if (!token || !transform.proposedIssue) return;
    
    setTransformations(prev => prev.map(t => t._id === transform._id ? { ...t, status: 'processing' } : t));
    
    try {
      // If it's a 1-to-1 replacement, we update in place
      if (transform.targetIssueNumbers.length === 1) {
        const issueNum = transform.targetIssueNumbers[0];
        await updateIssue(repoName, token, issueNum, {
          title: transform.proposedIssue.title,
          body: `${transform.proposedIssue.body}\n\n---\n*Refined via AI Backlog Audit.*`,
          labels: [...transform.proposedIssue.labels, 'refined']
        });
        await addComment(repoName, token, issueNum, "🚀 This issue has been refined with technically detailed specifications and acceptance criteria.");
      } else {
        // Multi-issue consolidation or pure replacement
        const body = `${transform.proposedIssue.body}\n\n---\n*Created via AI Backlog Refinement.*\n*Replacing: ${transform.targetIssueNumbers.map(n => `#${n}`).join(', ')}*`;
        await createIssue(repoName, token, {
          title: transform.proposedIssue.title,
          body,
          labels: [...transform.proposedIssue.labels, 'maintenance-replacement']
        });
        for (const num of transform.targetIssueNumbers) {
          await addComment(repoName, token, num, `Closing in favor of consolidated refinement. Reason: ${transform.reason}`);
          await updateIssue(repoName, token, num, { state: 'closed' });
        }
      }
      setTransformations(prev => prev.map(t => t._id === transform._id ? { ...t, status: 'success' } : t));
    } catch (err) {
      setTransformations(prev => prev.map(t => t._id === transform._id ? { ...t, status: 'error' } : t));
    }
  };

  const executeBulkTransformations = async () => {
    const selected = transformations.filter(t => selectedTransformIds.has(t._id) && t.status !== 'success');
    if (selected.length === 0) return;

    setIsBulkProcessing(true);
    setProgress({ current: 0, total: selected.length });

    for (let i = 0; i < selected.length; i++) {
      await handleRefineSingle(selected[i]);
      setProgress(p => ({ ...p, current: i + 1 }));
    }

    setIsBulkProcessing(false);
    loadIssues();
  };

  const getTransformIcon = (type: string, targets: number[]) => {
    if (targets.length === 1 && type === 'REPLACE') return <FileEdit className="w-4 h-4 text-blue-400" />;
    switch(type) {
      case 'CONSOLIDATE': return <Layers className="w-4 h-4 text-purple-400" />;
      case 'PRUNE': return <Trash2 className="w-4 h-4 text-red-400" />;
      case 'TRIAGE_ONLY': return <Tag className="w-4 h-4 text-green-400" />;
      default: return <RefreshCw className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Sparkles className="text-primary w-8 h-8" /> One-by-One Refinement
          </h2>
          <p className="text-slate-400">Transform vague issues into high-quality technical specifications individually.</p>
        </div>
        {isBulkProcessing && (
          <div className="text-sm font-mono text-blue-400 bg-blue-900/10 px-4 py-2 rounded-lg border border-blue-500/30 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Processing: {progress.current} / {progress.total}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        <div className="lg:col-span-1 space-y-6 sticky top-24">
          <div className="bg-surface border border-slate-700 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
               <h3 className="font-bold text-white uppercase tracking-widest text-xs">Backlog Health</h3>
               {maintenanceAnalysis.result && (
                 <div className={clsx(
                   "text-2xl font-black",
                   maintenanceAnalysis.result.healthScore > 80 ? "text-green-500" : "text-yellow-500"
                 )}>{maintenanceAnalysis.result.healthScore}%</div>
               )}
            </div>

            <Button 
              className="w-full mb-4 py-3" 
              onClick={runAudit} 
              isLoading={maintenanceAnalysis.status === 'LOADING'}
              icon={Sparkles}
            >
              Scan for Improvements
            </Button>

            {maintenanceAnalysis.result && (
              <div className="pt-4 border-t border-slate-700">
                   <div className="flex justify-between items-center mb-4">
                      <span className="text-xs font-bold text-slate-500">{transformations.length} Candidates</span>
                      <input 
                        type="checkbox" 
                        checked={selectedTransformIds.size === transformations.length && transformations.length > 0} 
                        onChange={() => setSelectedTransformIds(selectedTransformIds.size === transformations.length ? new Set() : new Set(transformations.map(t => t._id)))}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                      />
                   </div>
                   <Button variant="success" className="w-full" onClick={executeBulkTransformations} disabled={selectedTransformIds.size === 0 || isBulkProcessing} icon={Play}>
                     Apply Selected ({selectedTransformIds.size})
                   </Button>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
           {maintenanceAnalysis.status === 'LOADING' ? (
             <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                <p className="font-medium text-slate-300">Auditing HRM Backlog...</p>
                <p className="text-xs mt-2 opacity-60">Applying repo-specific templates to every ticket.</p>
             </div>
           ) : transformations.length === 0 ? (
             <div className="bg-surface border border-slate-700 rounded-2xl p-20 text-center text-slate-500 border-dashed">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Run refinement scan to generate one-by-one improvements.</p>
             </div>
           ) : (
             transformations.map(transform => (
               <div key={transform._id} className={clsx(
                 "bg-surface border rounded-xl overflow-hidden transition-all duration-200", 
                 selectedTransformIds.has(transform._id) ? "border-primary shadow-lg ring-1 ring-primary/10" : "border-slate-700",
                 transform.status === 'success' ? "opacity-75 grayscale-[0.5]" : ""
               )}>
                  <div className="p-5 flex gap-5 items-start">
                     <div className="pt-1 flex flex-col items-center gap-4">
                        {transform.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> :
                         transform.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> :
                         <input type="checkbox" checked={selectedTransformIds.has(transform._id)} onChange={() => { const n = new Set(selectedTransformIds); if(n.has(transform._id)) n.delete(transform._id); else n.add(transform._id); setSelectedTransformIds(n); }} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary" />}
                        <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 shadow-inner">
                          {getTransformIcon(transform.type, transform.targetIssueNumbers)}
                        </div>
                     </div>
                     
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                           <Badge variant={transform.targetIssueNumbers.length === 1 ? 'blue' : 'purple'}>
                             {transform.targetIssueNumbers.length === 1 ? 'Individual Refinement' : 'Consolidation'}
                           </Badge>
                           <span className="text-[10px] text-slate-500 font-bold uppercase font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                             Target: {transform.targetIssueNumbers.map(n => `#${n}`).join(', ')}
                           </span>
                        </div>

                        <div className="flex justify-between items-start gap-4 mb-4">
                           <div className="flex-1 min-w-0">
                              <h4 className="text-white font-bold text-lg mb-1">{transform.proposedIssue?.title || `Prune Issue`}</h4>
                              <p className="text-sm text-slate-400 italic">"{transform.reason}"</p>
                           </div>
                           <Button size="sm" variant="ghost" onClick={() => handleRefineSingle(transform)} disabled={transform.status === 'success'} className="shrink-0 h-9 border border-slate-700/50">
                             {transform.status === 'success' ? <><CheckCircle2 className="w-3 h-3" /> Applied</> : <><RefreshCw className="w-3 h-3" /> Apply Now</>}
                           </Button>
                        </div>

                        <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                           <span className="flex items-center gap-1.5"><Rocket className="w-3.5 h-3.5 text-blue-400" /> Quality Rebuild</span>
                           <span className="h-1 w-1 bg-slate-700 rounded-full" />
                           <button onClick={() => setTransformations(prev => prev.map(p => p._id === transform._id ? { ...p, expanded: !p.expanded } : p))} className="text-primary hover:underline flex items-center gap-1">
                              {transform.expanded ? 'Collapse Details' : 'Preview Spec'}
                              {transform.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                           </button>
                        </div>
                     </div>
                  </div>

                  {transform.expanded && transform.proposedIssue && (
                    <div className="px-6 pb-6 animate-in slide-in-from-top-2 duration-300">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                         <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-800">
                            <span className="text-[10px] font-black text-slate-600 uppercase mb-2 block">Issue Metadata</span>
                            <div className="flex flex-wrap gap-2">
                               <Badge variant="red">{transform.proposedIssue.priority} Priority</Badge>
                               <Badge variant="purple">{transform.proposedIssue.effort} Effort</Badge>
                               {transform.proposedIssue.labels.map(l => <Badge key={l} variant="slate">{l}</Badge>)}
                            </div>
                         </div>
                         <div className="bg-blue-900/10 p-4 rounded-lg border border-blue-900/30">
                            <span className="text-[10px] font-black text-blue-500/70 uppercase mb-2 block">Audit Impact</span>
                            <p className="text-xs text-blue-200/80 leading-relaxed">{transform.impact}</p>
                         </div>
                       </div>
                       
                       <div className="bg-slate-950/50 p-6 rounded-xl border border-slate-800 shadow-inner">
                          <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800/50">
                             <div className="flex items-center gap-2">
                               <Rocket className="w-4 h-4 text-primary" />
                               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Master Specification</span>
                             </div>
                             <span className="text-[10px] text-slate-500 font-mono italic">Ready for Dispatch</span>
                          </div>
                          <div className="prose prose-invert prose-sm max-w-none prose-blue">
                             <ReactMarkdown>{transform.proposedIssue.body}</ReactMarkdown>
                          </div>
                       </div>
                    </div>
                  )}
               </div>
             ))
           )}
        </div>
      </div>
    </div>
  );
};

export default Issues;
