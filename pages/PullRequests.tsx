
import React, { useState, useEffect } from 'react';
import { fetchEnrichedPullRequests, updateIssue, addComment, addLabels } from '../services/githubService';
import { analyzePullRequests } from '../services/geminiService';
import { listSessions } from '../services/julesService';
import { EnrichedPullRequest, JulesSession, PrHealthAction } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { GitPullRequest, GitMerge, Clock, User, CheckCircle2, AlertTriangle, FileCode, Check, X, ShieldAlert, FlaskConical, AlertCircle, HelpCircle, Loader2, TerminalSquare, Play, Tag, MessageSquare, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

interface PullRequestsProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type PrHealthActionUI = PrHealthAction & { _id: string };

const PullRequests: React.FC<PullRequestsProps> = ({ repoName, token, julesApiKey }) => {
  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [julesSessions, setJulesSessions] = useState<JulesSession[]>([]);
  
  // Smart Actions State
  const [healthActions, setHealthActions] = useState<PrHealthActionUI[]>([]);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [actionProcessing, setActionProcessing] = useState(false);

  const navigate = useNavigate();
  
  // Cache the PR health check result
  const analysis = useGeminiAnalysis(analyzePullRequests, 'pr_health_check');

  useEffect(() => {
    const loadPrs = async () => {
      setLoading(true);
      try {
        const data = await fetchEnrichedPullRequests(repoName, token);
        setPrs(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadPrs();
  }, [repoName, token]);

  useEffect(() => {
    if (julesApiKey) {
      listSessions(julesApiKey).then(setJulesSessions).catch(console.error);
    }
  }, [julesApiKey]);

  // Sync actions when analysis completes
  useEffect(() => {
    if (analysis.result?.actions) {
       setHealthActions(analysis.result.actions.map(a => ({ ...a, _id: Math.random().toString(36).substr(2, 9) })));
    }
  }, [analysis.result]);

  const handleAnalyze = async () => {
    setHealthActions([]);
    await analysis.run(prs);
  };

  const executeHealthActions = async () => {
    if (!token) return alert("GitHub Token required");
    setActionProcessing(true);
    const selected = healthActions.filter(a => selectedActionIds.has(a._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        if (item.action === 'close') {
          await updateIssue(repoName, token, item.prNumber, { state: 'closed' });
          if (item.suggestedComment) {
            await addComment(repoName, token, item.prNumber, item.suggestedComment);
          }
        } else if (item.action === 'comment' && item.suggestedComment) {
          await addComment(repoName, token, item.prNumber, item.suggestedComment);
        } else if (item.action === 'label' && item.label) {
          await addLabels(repoName, token, item.prNumber, [item.label]);
        }
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e); 
        errors.push(`PR #${item.prNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to execute actions on ${errors.length} PRs:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    }

    setHealthActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedActionIds(prev => { 
      const next = new Set(prev); 
      successIds.forEach(id => next.delete(id)); 
      return next; 
    });
    setActionProcessing(false);
  };

  const toggleSelectAll = () => {
    if (selectedActionIds.size === healthActions.length) setSelectedActionIds(new Set());
    else setSelectedActionIds(new Set(healthActions.map(a => a._id)));
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedActionIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedActionIds(next);
  };

  const getActiveSessionForPr = (pr: EnrichedPullRequest) => {
    return julesSessions.find(s => {
      // Must be in an active state
      const isActive = ['RUNNING', 'PENDING', 'IN_PROGRESS', 'AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'].includes(s.state);
      if (!isActive) return false;

      // Check branch match
      const sessionBranch = s.sourceContext?.githubRepoContext?.startingBranch;
      if (sessionBranch && sessionBranch === pr.head.ref) return true;
      
      return false;
    });
  };

  const goToSession = (session: JulesSession) => {
     navigate('/sessions', { state: { viewSessionName: session.name } });
  };

  const getReadyStatusBadge = (pr: EnrichedPullRequest) => {
    if (pr.testStatus === 'failed') {
      return <Badge variant="red" icon={AlertTriangle}>Fix Tests</Badge>;
    }
    if (pr.mergeable === false) {
       return <Badge variant="red" icon={X}>Conflict</Badge>;
    }
    if (pr.isReadyToMerge) {
      return <Badge variant="green" icon={CheckCircle2}>Ready</Badge>;
    }
    if (pr.isLeaderBranch && pr.testStatus !== 'passed') {
      return <Badge variant="yellow" icon={FlaskConical}>Testing</Badge>;
    }
    return <Badge variant="slate">Review</Badge>;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Pull Request Status Board</h2>
        <p className="text-slate-400">At-a-glance status of merge conflicts, test results, and readiness.</p>
      </div>

      <AnalysisCard 
        title="PR Health Check (AI)"
        description="Identify stale PRs, potential conflicts, and redundant work."
        status={analysis.status}
        result={analysis.result?.report || null}
        onAnalyze={handleAnalyze}
        repoName={repoName}
        disabled={loading || prs.length === 0}
      />

      {/* Smart Actions Console */}
      {healthActions.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden mb-8 animate-in fade-in slide-in-from-top-4">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
            <div className="flex items-center gap-3">
               <input 
                 type="checkbox" 
                 checked={healthActions.length > 0 && selectedActionIds.size === healthActions.length}
                 onChange={toggleSelectAll}
                 className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                 title="Select All"
               />
               <h3 className="font-semibold text-white">Recommended Actions ({healthActions.length})</h3>
            </div>
            <Button variant="primary" size="sm" onClick={executeHealthActions} disabled={selectedActionIds.size === 0 || actionProcessing} isLoading={actionProcessing} icon={Play}>Execute Selected</Button>
          </div>
          
          <div className="divide-y divide-slate-700 max-h-[400px] overflow-y-auto">
             {healthActions.map(action => (
               <div key={action._id} className={clsx("p-4 flex gap-4 transition-colors", selectedActionIds.has(action._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                 <div className="pt-1">
                    <input type="checkbox" checked={selectedActionIds.has(action._id)} onChange={() => toggleSelection(action._id)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer shrink-0" />
                 </div>
                 <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-slate-500 text-sm">#{action.prNumber}</span>
                      <span className="text-white font-medium truncate">{action.title}</span>
                      <Badge variant={action.action === 'close' ? 'red' : action.action === 'comment' ? 'blue' : 'yellow'}>{action.action.toUpperCase()}</Badge>
                      <Badge variant={action.confidence === 'high' ? 'green' : 'gray'}>{action.confidence} Confidence</Badge>
                    </div>
                    
                    <p className="text-slate-300 text-sm mb-2">{action.reason}</p>
                    
                    {action.suggestedComment && (
                       <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-xs text-slate-400 font-mono italic">
                          "{action.suggestedComment}"
                       </div>
                    )}
                    {action.label && (
                       <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-slate-500">Apply Label:</span>
                          <Badge variant="blue" icon={Tag}>{action.label}</Badge>
                       </div>
                    )}
                 </div>
               </div>
             ))}
          </div>
        </div>
      )}

      <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-blue-500" />
            Active PRs
          </h3>
          <Badge variant="blue">{prs.length} Open</Badge>
        </div>
        
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="flex flex-col items-center">
               <Loader2 className="w-8 h-8 animate-spin mb-4" />
               <p>Fetching PR details & status checks...</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-slate-900/40 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-700">
                   <th className="px-6 py-4">Pull Request</th>
                   <th className="px-6 py-4">Target</th>
                   <th className="px-6 py-4">Merge Status</th>
                   <th className="px-6 py-4">Tests</th>
                   <th className="px-6 py-4">Size</th>
                   <th className="px-6 py-4 text-right">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-700">
                 {prs.map(pr => {
                   const activeSession = getActiveSessionForPr(pr);
                   return (
                   <tr key={pr.id} className="hover:bg-slate-800/30 transition-colors group">
                     {/* 1. PR Info */}
                     <td className="px-6 py-4 max-w-md">
                        <div className="flex items-start gap-3">
                           <div className={clsx("mt-1 shrink-0", pr.draft ? "text-slate-500" : "text-green-500")}>
                             {pr.draft ? <FileCode className="w-5 h-5" /> : <GitMerge className="w-5 h-5" />}
                           </div>
                           <div className="min-w-0">
                             <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-white hover:text-primary truncate transition-colors">
                               {pr.title}
                             </a>
                             <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                               <span className="font-mono">#{pr.number}</span>
                               <span className="flex items-center gap-1"><User className="w-3 h-3"/> {pr.user.login}</span>
                               {activeSession && (
                                 <button 
                                   onClick={() => goToSession(activeSession)}
                                   className="flex items-center gap-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 hover:bg-purple-500/30 transition-colors ml-2 animate-pulse"
                                   title="Jules Session Active"
                                 >
                                   <TerminalSquare className="w-3 h-3" /> Jules
                                 </button>
                               )}
                             </div>
                           </div>
                        </div>
                     </td>

                     {/* 2. Target Branch */}
                     <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700">{pr.base.ref}</span>
                          {pr.isLeaderBranch && (
                            <span title="Protected Branch">
                              <ShieldAlert className="w-3 h-3 text-amber-500" />
                            </span>
                          )}
                        </div>
                     </td>

                     {/* 3. Merge Status */}
                     <td className="px-6 py-4">
                        {pr.mergeable === true ? (
                          <div className="flex items-center gap-2 text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /><span className="text-xs">No Conflicts</span></div>
                        ) : pr.mergeable === false ? (
                          <div className="flex items-center gap-2 text-red-400 text-sm"><X className="w-4 h-4" /><span className="text-xs">Conflicts</span></div>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-500 text-sm"><HelpCircle className="w-4 h-4" /><span className="text-xs">Unknown</span></div>
                        )}
                     </td>

                     {/* 4. Test Results */}
                     <td className="px-6 py-4">
                          <div className={clsx("flex items-center gap-2 text-sm", pr.testStatus === 'passed' ? "text-green-400" : pr.testStatus === 'failed' ? "text-red-400" : "text-slate-400")}>
                             {pr.testStatus === 'passed' && <Check className="w-4 h-4" />}
                             {pr.testStatus === 'failed' && <AlertCircle className="w-4 h-4" />}
                             {(pr.testStatus === 'pending' || pr.testStatus === 'unknown') && <Clock className="w-4 h-4" />}
                             <span className="text-xs capitalize">{pr.testStatus}</span>
                          </div>
                     </td>

                     {/* 5. Size */}
                     <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <Badge variant={pr.isBig ? 'purple' : 'gray'}>{pr.isBig ? 'Large' : 'Small'}</Badge>
                          <span className="text-[10px] text-slate-500">{pr.changed_files} files</span>
                        </div>
                     </td>

                     {/* 6. Action / Status */}
                     <td className="px-6 py-4 text-right">
                        {getReadyStatusBadge(pr)}
                     </td>
                   </tr>
                   );
                 })}
                 {prs.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-slate-500">No active pull requests found.</td></tr>}
               </tbody>
             </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PullRequests;
