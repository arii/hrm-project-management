
import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, Trash2, Link as LinkIcon, AlertTriangle, ArrowRight, Play, GitMerge, TerminalSquare, RotateCcw, Loader2, CheckCircle2, Link2, ExternalLink, GitPullRequest, Info, FileWarning, CheckCircle, MessageSquarePlus, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { fetchIssues, fetchPullRequests, createIssue, updateIssue, addComment, fetchEnrichedPullRequests, addLabels, publishPullRequest, fetchCoreRepoContext } from '../services/githubService';
import { suggestStrategicIssues, auditPullRequests, findIssuePrLinks, analyzeJulesSessions } from '../services/geminiService';
import { listSessions, deleteSession, sendMessage, createSession, findSourceForRepo } from '../services/julesService';
import { ProposedIssue, PrActionRecommendation, LinkSuggestion, JulesAgentAction, MergeProposal } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

interface AgentProps { repoName: string; token: string; julesApiKey?: string; }

type ProposedWithStatus = ProposedIssue & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type PrActionWithStatus = PrActionRecommendation & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type LinkWithStatus = LinkSuggestion & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };
type OperatorWithStatus = JulesAgentAction & { _id: string; status: 'idle' | 'processing' | 'success' | 'error' };

const generateId = () => Math.random().toString(36).substr(2, 9);

const Agent: React.FC<AgentProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'architect' | 'overseer' | 'janitor' | 'operator'>('architect');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  const [proposedIssues, setProposedIssues] = useState<ProposedWithStatus[]>([]);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [prActions, setPrActions] = useState<PrActionWithStatus[]>([]);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<LinkWithStatus[]>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [operatorActions, setOperatorActions] = useState<OperatorWithStatus[]>([]);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<Set<string>>(new Set());

  const architectAnalysis = useGeminiAnalysis(async () => {
     const [issues, prs, repoContext] = await Promise.all([
       fetchIssues(repoName, token, 'open'), 
       fetchPullRequests(repoName, token, 'open'),
       fetchCoreRepoContext(repoName, token)
     ]);
     const result = await suggestStrategicIssues(issues, prs, repoContext, '');
     setProposedIssues(result.issues.map(s => ({ ...s, _id: generateId(), status: 'idle' })));
     return result;
  }, 'agent_architect_v2');

  const overseerAnalysis = useGeminiAnalysis(async () => {
     const prs = await fetchPullRequests(repoName, token, 'open');
     const result = await auditPullRequests(prs);
     setPrActions(result.map(a => ({ ...a, _id: generateId(), status: 'idle' })));
     return result;
  }, 'agent_overseer');

  const janitorAnalysis = useGeminiAnalysis(async () => {
     const [openIssues, openPrs] = await Promise.all([fetchIssues(repoName, token, 'open'), fetchPullRequests(repoName, token, 'open')]);
     const result = await findIssuePrLinks(openIssues, openPrs);
     setLinks(result.map(m => ({ ...m, _id: generateId(), status: 'idle' })));
     return result;
  }, 'agent_janitor');

  const operatorAnalysis = useGeminiAnalysis(async () => {
    if (!julesApiKey) throw new Error("Key missing");
    const [sessions, prs] = await Promise.all([listSessions(julesApiKey), fetchEnrichedPullRequests(repoName, token)]);
    const result = await analyzeJulesSessions(sessions, prs);
    setOperatorActions(result.map(a => ({ ...a, _id: generateId(), status: 'idle' })));
    return result;
  }, 'agent_operator');

  const executeBulkIssues = async () => {
    const selected = proposedIssues.filter(i => selectedIssueIds.has(i._id) && i.status !== 'success');
    if (selected.length === 0) return;
    setIsBulkProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const issue = selected[i];
      setProposedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'processing' } : p));
      try {
        await createIssue(repoName, token, { title: issue.title, body: issue.body, labels: issue.labels });
        setProposedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'success' } : p));
        setProgress(p => ({ ...p, current: i + 1 }));
      } catch { setProposedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'error' } : p)); }
    }
    setIsBulkProcessing(false);
  };

  const executeBulkPrActions = async () => {
    const selected = prActions.filter(a => selectedActionIds.has(a._id) && a.status !== 'success');
    if (selected.length === 0) return;
    setIsBulkProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setPrActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'processing' } : p));
      try {
        if (item.action === 'close') await updateIssue(repoName, token, item.prNumber, { state: 'closed' });
        else if (item.action === 'comment' && item.suggestedComment) await addComment(repoName, token, item.prNumber, item.suggestedComment);
        else if (item.action === 'prioritize') await addLabels(repoName, token, item.prNumber, ['priority:high']);
        else if (item.action === 'publish') await publishPullRequest(repoName, token, item.prNumber);
        setPrActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'success' } : p));
        setProgress(p => ({ ...p, current: i + 1 }));
      } catch { setPrActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'error' } : p)); }
    }
    setIsBulkProcessing(false);
  };

  const executeBulkLinks = async () => {
    const selected = links.filter(l => selectedLinkIds.has(l._id) && l.status !== 'success');
    if (selected.length === 0) return;
    setIsBulkProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setLinks(prev => prev.map(p => p._id === item._id ? { ...p, status: 'processing' } : p));
      try {
        await addComment(repoName, token, item.prNumber, `Semantic Link Identified: This PR relates to #${item.issueNumber}.\n\n*Reason: ${item.reason}*`);
        setLinks(prev => prev.map(p => p._id === item._id ? { ...p, status: 'success' } : p));
        setProgress(p => ({ ...p, current: i + 1 }));
      } catch { setLinks(prev => prev.map(p => p._id === item._id ? { ...p, status: 'error' } : p)); }
    }
    setIsBulkProcessing(false);
  };

  const executeBulkOperatorActions = async () => {
    if (!julesApiKey) return;
    const selected = operatorActions.filter(a => selectedOperatorIds.has(a._id) && a.status !== 'success');
    if (selected.length === 0) return;
    setIsBulkProcessing(true);
    setProgress({ current: 0, total: selected.length });
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setOperatorActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'processing' } : p));
      try {
        const shortName = item.sessionName.split('/').pop() || item.sessionName;
        if (item.action === 'delete') await deleteSession(julesApiKey, shortName);
        else if (item.action === 'message' && item.suggestedCommand) await sendMessage(julesApiKey, shortName, item.suggestedCommand);
        else if (item.action === 'recover') await sendMessage(julesApiKey, shortName, item.suggestedCommand || "Create a Pull Request for the changes.");
        setOperatorActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'success' } : p));
        setProgress(p => ({ ...p, current: i + 1 }));
      } catch { setOperatorActions(prev => prev.map(p => p._id === item._id ? { ...p, status: 'error' } : p)); }
    }
    setIsBulkProcessing(false);
  };

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><Bot className="text-purple-500 w-8 h-8" /> Repo Agent</h2>
          <p className="text-slate-400">Autonomous repository management assistance.</p>
        </div>
        {isBulkProcessing && <div className="text-sm font-mono text-purple-400 bg-purple-900/10 px-3 py-1.5 rounded-lg border border-purple-500/20">Task: {progress.current} / {progress.total}</div>}
      </div>

      <div className="flex border-b border-slate-700 mb-8 overflow-x-auto no-scrollbar">
        {['architect', 'overseer', 'janitor', 'operator'].map(id => (
          <button 
            key={id} 
            onClick={() => setActiveTab(id as any)} 
            className={clsx("px-6 py-4 font-medium border-b-2 capitalize transition-colors", activeTab === id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-200")}
          >
            {id}
          </button>
        ))}
      </div>

      {activeTab === 'architect' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard title="Architect Discovery" description="Identify strategic gaps based on actual code and dependency analysis." status={architectAnalysis.status} result={null} onAnalyze={architectAnalysis.run} repoName={repoName} />
           {proposedIssues.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={selectedIssueIds.size === proposedIssues.length} onChange={() => setSelectedIssueIds(selectedIssueIds.size === proposedIssues.length ? new Set() : new Set(proposedIssues.map(p => p._id)))} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />
                     <h3 className="font-bold text-white text-sm uppercase tracking-wider">Proposed Issues ({proposedIssues.length})</h3>
                   </div>
                   <Button onClick={executeBulkIssues} disabled={selectedIssueIds.size === 0 || isBulkProcessing} isLoading={isBulkProcessing} variant="primary" icon={Play}>Dispatch Selection</Button>
                </div>
                {proposedIssues.map(issue => (
                  <div key={issue._id} className={clsx("p-5 flex gap-4 border-b border-slate-700 last:border-0", issue.status === 'processing' && "bg-blue-900/5")}>
                     {issue.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : issue.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <input type="checkbox" checked={selectedIssueIds.has(issue._id)} onChange={() => { const n = new Set(selectedIssueIds); if(n.has(issue._id)) n.delete(issue._id); else n.add(issue._id); setSelectedIssueIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-primary" />}
                     <div className="flex-1">
                        <h4 className="text-white font-medium">{issue.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{issue.reason}</p>
                        <div className="flex gap-2 mt-3">
                           <Badge variant="slate">{issue.effort}</Badge>
                           <Badge variant={issue.priority === 'High' ? 'red' : 'blue'}>{issue.priority}</Badge>
                        </div>
                     </div>
                  </div>
                ))}
             </div>
           )}
        </div>
      )}

      {activeTab === 'overseer' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard title="Overseer Audit" description="Review PR status and nudge reviewers or authors." status={overseerAnalysis.status} result={null} onAnalyze={overseerAnalysis.run} repoName={repoName} />
           {prActions.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={selectedActionIds.size === prActions.length} onChange={() => setSelectedActionIds(selectedActionIds.size === prActions.length ? new Set() : new Set(prActions.map(p => p._id)))} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />
                     <h3 className="font-bold text-white text-sm uppercase tracking-wider">PR Recommendations ({prActions.length})</h3>
                   </div>
                   <Button onClick={executeBulkPrActions} disabled={selectedActionIds.size === 0 || isBulkProcessing} isLoading={isBulkProcessing} variant="primary" icon={Play}>Run Selected</Button>
                </div>
                {prActions.map(action => (
                  <div key={action._id} className={clsx("p-5 flex gap-4 border-b border-slate-700 last:border-0", action.status === 'processing' && "bg-blue-900/5")}>
                     {action.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : action.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <input type="checkbox" checked={selectedActionIds.has(action._id)} onChange={() => { const n = new Set(selectedActionIds); if(n.has(action._id)) n.delete(action._id); else n.add(action._id); setSelectedActionIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-primary" />}
                     <div className="flex-1">
                        <div className="flex items-center gap-2">
                           <span className="font-mono text-xs text-slate-500">PR #{action.prNumber}</span>
                           <Badge variant="blue">{action.action}</Badge>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{action.reason}</p>
                     </div>
                  </div>
                ))}
             </div>
           )}
        </div>
      )}

      {activeTab === 'janitor' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard title="Janitor Linker" description="Detect semantic links between issues and PRs that aren't explicitly connected." status={janitorAnalysis.status} result={null} onAnalyze={janitorAnalysis.run} repoName={repoName} />
           {links.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={selectedLinkIds.size === links.length} onChange={() => setSelectedLinkIds(selectedLinkIds.size === links.length ? new Set() : new Set(links.map(p => p._id)))} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />
                     <h3 className="font-bold text-white text-sm uppercase tracking-wider">Semantic Links ({links.length})</h3>
                   </div>
                   <Button onClick={executeBulkLinks} disabled={selectedLinkIds.size === 0 || isBulkProcessing} isLoading={isBulkProcessing} variant="primary" icon={Link2}>Link Selected</Button>
                </div>
                {links.map(link => (
                  <div key={link._id} className={clsx("p-5 flex gap-4 border-b border-slate-700 last:border-0", link.status === 'processing' && "bg-blue-900/5")}>
                     {link.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : link.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <input type="checkbox" checked={selectedLinkIds.has(link._id)} onChange={() => { const n = new Set(selectedLinkIds); if(n.has(link._id)) n.delete(link._id); else n.add(link._id); setSelectedLinkIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-primary" />}
                     <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                           <div className="flex items-center gap-2">
                              <Badge variant="blue">PR #{link.prNumber}</Badge>
                              <ArrowRight className="w-3 h-3 text-slate-500" />
                              <Badge variant="yellow">Issue #{link.issueNumber}</Badge>
                           </div>
                           <Badge variant="slate">{link.confidence} Confidence</Badge>
                        </div>
                        <p className="text-xs text-slate-300 font-medium">{link.prTitle} relates to {link.issueTitle}</p>
                        <p className="text-[10px] text-slate-500 mt-1 italic">{link.reason}</p>
                     </div>
                  </div>
                ))}
             </div>
           )}
        </div>
      )}

      {activeTab === 'operator' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard title="Session Operator" description="Maintain Jules sessions, clean up resources, and request PRs for finished tasks." status={operatorAnalysis.status} result={null} onAnalyze={operatorAnalysis.run} repoName={repoName} />
           {operatorActions.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input type="checkbox" checked={selectedOperatorIds.size === operatorActions.length} onChange={() => setSelectedOperatorIds(selectedOperatorIds.size === operatorActions.length ? new Set() : new Set(operatorActions.map(p => p._id)))} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />
                     <h3 className="font-bold text-white text-sm uppercase tracking-wider">AI Management Tasks ({operatorActions.length})</h3>
                   </div>
                   <Button onClick={executeBulkOperatorActions} disabled={selectedOperatorIds.size === 0 || isBulkProcessing || !julesApiKey} isLoading={isBulkProcessing} variant="primary" icon={RotateCcw}>Execute Tasks</Button>
                </div>
                <div className="divide-y divide-slate-700">
                  {operatorActions.map(action => {
                    const isStuck = (action.action === 'message' || action.action === 'recover') && !action.hasPr;
                    const isCleanable = action.action === 'delete' && action.hasPr;

                    return (
                    <div key={action._id} className={clsx("p-6 flex gap-6 transition-all", action.status === 'processing' ? "bg-purple-900/5" : "hover:bg-slate-800/10")}>
                       <div className="pt-1">
                          {action.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin text-purple-500" /> : 
                           action.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
                           <input type="checkbox" checked={selectedOperatorIds.has(action._id)} onChange={() => { const n = new Set(selectedOperatorIds); if (n.has(action._id)) n.delete(action._id); else n.add(action._id); setSelectedOperatorIds(n); }} className="w-5 h-5 rounded bg-slate-800 text-primary cursor-pointer" />}
                       </div>
                       <div className="flex-1 min-w-0">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                             <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 relative">
                                   <TerminalSquare className="w-5 h-5 text-purple-400" />
                                   {!action.hasPr && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-surface shadow-sm" />}
                                </div>
                                <div>
                                   <h4 className="text-white font-bold font-mono text-sm truncate max-w-xs">{action.sessionName.split('/').pop()}</h4>
                                   <div className="flex items-center gap-2 mt-1">
                                      {action.hasPr ? (
                                        <Badge variant="green" icon={GitPullRequest} className="text-[9px]">PR Linked</Badge>
                                      ) : (
                                        <Badge variant="red" icon={FileWarning} className="text-[9px]">No PR Found</Badge>
                                      )}
                                      {action.prStatus && (
                                        <Badge variant={action.prStatus.includes('APPROVED') ? 'green' : 'slate'} className="text-[9px] lowercase">
                                          {action.prStatus}
                                        </Badge>
                                      )}
                                      {isStuck && (
                                        <Badge variant="yellow" className="text-[9px] animate-pulse">Stuck</Badge>
                                      )}
                                   </div>
                                </div>
                             </div>
                             <div className="flex items-center gap-3">
                                <Badge variant={action.action === 'delete' ? 'red' : (action.action === 'message' || action.action === 'recover') ? 'blue' : 'yellow'} className="py-1 px-3">
                                   {action.action.toUpperCase()} RECOMMENDATION
                                </Badge>
                             </div>
                          </div>
                          
                          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 mb-4">
                             <div className="flex items-start gap-3">
                                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                                <p className="text-sm text-slate-300 leading-relaxed">{action.reason}</p>
                             </div>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            {isStuck && (
                              <div className="bg-amber-900/10 border border-amber-900/30 p-4 rounded-xl flex-1 min-w-[300px] flex items-center justify-between group">
                                 <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-500/20 rounded-lg">
                                      <MessageSquarePlus className="w-5 h-5 text-amber-500" />
                                    </div>
                                    <div>
                                       <p className="text-xs font-bold text-amber-200">Manual PR Request Required</p>
                                       <p className="text-[10px] text-amber-400/80">Task is finished but no PR was created. Send request command.</p>
                                    </div>
                                 </div>
                                 <code className="text-[10px] bg-slate-950 px-2 py-1 rounded border border-slate-800 text-blue-300 group-hover:border-blue-500/30 transition-colors">
                                    {action.suggestedCommand || "/create-pr"}
                                 </code>
                              </div>
                            )}

                            {isCleanable && (
                               <div className="bg-green-900/10 border border-green-900/30 p-4 rounded-xl flex-1 min-w-[300px] flex items-center justify-between">
                                 <div className="flex items-center gap-3">
                                    <div className="p-2 bg-green-500/20 rounded-lg">
                                      <ShieldCheck className="w-5 h-5 text-green-500" />
                                    </div>
                                    <div>
                                       <p className="text-xs font-bold text-green-200">Safe to Prune</p>
                                       <p className="text-[10px] text-green-400/80">Approved & passing CI. Free up capacity for new sessions.</p>
                                    </div>
                                 </div>
                                 <div className="text-[10px] font-mono text-green-500/50 uppercase font-bold">Verified Clean</div>
                              </div>
                            )}
                          </div>
                       </div>
                    </div>
                  )})}
                </div>
             </div>
           )}
        </div>
      )}
    </div>
  );
};

export default Agent;
