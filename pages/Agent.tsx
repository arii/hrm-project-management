
import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, Trash2, Link as LinkIcon, AlertTriangle, ArrowRight, Check, Play, Zap, Target, Wrench, Search, Code2, FileSearch, Box, TerminalSquare, MessageSquare, Send, GitMerge, RotateCcw, Lightbulb, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { fetchIssues, fetchPullRequests, createIssue, updateIssue, addComment, fetchEnrichedPullRequests, addLabels, publishPullRequest } from '../services/githubService';
import { suggestStrategicIssues, auditPullRequests, findIssuePrLinks, analyzeJulesSessions, suggestMergeableBranches } from '../services/geminiService';
import { listSessions, deleteSession, sendMessage, createSession, findSourceForRepo } from '../services/julesService';
import { ProposedIssue, PrActionRecommendation, LinkSuggestion, JulesAgentAction, MergeProposal } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

interface AgentProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type ProposedIssueWithId = ProposedIssue & { _id: string };
type PrActionWithId = PrActionRecommendation & { _id: string };
type LinkSuggestionWithId = LinkSuggestion & { _id: string };
type OperatorActionWithId = JulesAgentAction & { _id: string };
type MergeProposalWithId = MergeProposal & { _id: string };

const generateId = () => Math.random().toString(36).substr(2, 9);

const Agent: React.FC<AgentProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'architect' | 'overseer' | 'janitor' | 'operator' | 'integrator'>('architect');
  const [bulkProcessing, setBulkProcessing] = useState(false);
  
  // Architect State
  const [proposedIssues, setProposedIssues] = useState<ProposedIssueWithId[]>([]);
  const [pivotSuggestion, setPivotSuggestion] = useState<{ mode: string, guidance: string, reason: string } | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [discoveryMode, setDiscoveryMode] = useState<string>('strategic');
  const [userGuidance, setUserGuidance] = useState('');
  
  // Overseer State
  const [prActions, setPrActions] = useState<PrActionWithId[]>([]);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());

  // Janitor State
  const [links, setLinks] = useState<LinkSuggestionWithId[]>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());

  // Operator State
  const [operatorActions, setOperatorActions] = useState<OperatorActionWithId[]>([]);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<Set<string>>(new Set());

  // Integrator State
  const [mergeProposals, setMergeProposals] = useState<MergeProposalWithId[]>([]);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [processingProposalId, setProcessingProposalId] = useState<string | null>(null);

  // Background Pre-fetch of PRs for responsiveness
  useEffect(() => {
    if (token && repoName) {
      fetchEnrichedPullRequests(repoName, token).catch(() => {});
    }
  }, [repoName, token]);

  // Use custom analysis hooks with persistence
  const architectAnalysis = useGeminiAnalysis(async () => {
     const [issues, prs] = await Promise.all([fetchIssues(repoName, token, 'open'), fetchPullRequests(repoName, token, 'open')]);
     const result = await suggestStrategicIssues(issues, prs, discoveryMode, userGuidance);
     
     const withIds = result.issues.map(s => ({ ...s, _id: generateId() }));
     setProposedIssues(withIds);
     setPivotSuggestion(result.suggestedPivot || null);
     setSelectedIssueIds(new Set());
     return result;
  }, 'agent_architect');

  const overseerAnalysis = useGeminiAnalysis(async () => {
     const prs = await fetchPullRequests(repoName, token, 'open');
     const actions = await auditPullRequests(prs);
     const withIds = actions.map(a => ({ ...a, _id: generateId() }));
     setPrActions(withIds);
     setSelectedActionIds(new Set());
     return withIds;
  }, 'agent_overseer');

  const janitorAnalysis = useGeminiAnalysis(async () => {
     // Fetch expanded data for Janitor to support history tracking and merged PR linking
     const [openIssues, closedIssues, openPrs, closedPrs] = await Promise.all([
        fetchIssues(repoName, token, 'open'),
        fetchIssues(repoName, token, 'closed'), 
        fetchPullRequests(repoName, token, 'open'),
        fetchPullRequests(repoName, token, 'closed')
     ]);

     // Combine to provide context, limit closed history to recent 50 to save tokens
     const issues = [...openIssues, ...closedIssues.slice(0, 50)];
     const prs = [...openPrs, ...closedPrs.slice(0, 50)];

     const matches = await findIssuePrLinks(issues, prs);
     const withIds = matches.map(m => ({ ...m, _id: generateId() }));
     setLinks(withIds);
     setSelectedLinkIds(new Set());
     return withIds;
  }, 'agent_janitor');

  const operatorAnalysis = useGeminiAnalysis(async () => {
    if (!julesApiKey) throw new Error("Jules API Key required");
    const [sessions, prs] = await Promise.all([
      listSessions(julesApiKey),
      fetchEnrichedPullRequests(repoName, token)
    ]);
    const actions = await analyzeJulesSessions(sessions, prs);
    const withIds = actions.map(a => ({ ...a, _id: generateId() }));
    setOperatorActions(withIds);
    setSelectedOperatorIds(new Set());
    return withIds;
  }, 'agent_operator');

  const integratorAnalysis = useGeminiAnalysis(async () => {
    const prs = await fetchEnrichedPullRequests(repoName, token);
    const proposals = await suggestMergeableBranches(prs);
    const withIds = proposals.map(p => ({ ...p, _id: generateId() }));
    setMergeProposals(withIds);
    setSelectedProposalIds(new Set());
    return withIds;
  }, 'agent_integrator');

  // Sync state from cached results on mount/update
  useEffect(() => {
    if (architectAnalysis.result) {
       setProposedIssues(architectAnalysis.result.issues.map(i => ({...i, _id: generateId()}))); // Simplified re-mapping for cache consistency
       setPivotSuggestion(architectAnalysis.result.suggestedPivot || null);
    }
    if (overseerAnalysis.result) setPrActions(overseerAnalysis.result);
    if (janitorAnalysis.result) setLinks(janitorAnalysis.result);
    if (operatorAnalysis.result) setOperatorActions(operatorAnalysis.result);
    if (integratorAnalysis.result) setMergeProposals(integratorAnalysis.result);
  }, [architectAnalysis.result, overseerAnalysis.result, janitorAnalysis.result, operatorAnalysis.result, integratorAnalysis.result]);


  // --- Handlers ---

  const handleApplyPivot = () => {
    if (!pivotSuggestion) return;
    setDiscoveryMode(pivotSuggestion.mode);
    setUserGuidance(pivotSuggestion.guidance);
    // Immediately re-run
    setTimeout(() => architectAnalysis.run(), 100);
  };

  const executeBulkIssues = async () => {
    if (!token) return alert("GitHub Token required");
    setBulkProcessing(true);
    const selected = proposedIssues.filter(i => selectedIssueIds.has(i._id));
    const successIds: string[] = [];
    const errors: string[] = [];
    
    for (const issue of selected) {
      try {
        await createIssue(repoName, token, {
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        });
        successIds.push(issue._id);
      } catch (e: any) { 
        console.error(e); 
        errors.push(`"${issue.title}": ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to create ${errors.length} issues:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    } else if (successIds.length > 0) {
      alert(`Successfully created ${successIds.length} issues.`);
    }

    setProposedIssues(prev => prev.filter(i => !successIds.includes(i._id)));
    setSelectedIssueIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setBulkProcessing(false);
  };

  const executeBulkPrActions = async () => {
    if (!token) return alert("GitHub Token required");
    setBulkProcessing(true);
    const selected = prActions.filter(a => selectedActionIds.has(a._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        if (item.action === 'close') {
          await updateIssue(repoName, token, item.prNumber, { state: 'closed' });
        } else if (item.action === 'comment' && item.suggestedComment) {
          await addComment(repoName, token, item.prNumber, item.suggestedComment);
        } else if (item.action === 'prioritize') {
          await addLabels(repoName, token, item.prNumber, ['priority:high']);
        } else if (item.action === 'publish') {
          // Attempt to convert draft to ready for review
          await publishPullRequest(repoName, token, item.prNumber);
          await addComment(repoName, token, item.prNumber, "Marking Ready for Review (RepoAuditor AI)");
        }
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e); 
        errors.push(`PR #${item.prNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to execute actions on ${errors.length} PRs:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    } else if (successIds.length > 0) {
      alert(`Successfully executed actions on ${successIds.length} PRs.`);
    }

    setPrActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedActionIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setBulkProcessing(false);
  };

  const executeBulkLinks = async () => {
    if (!token) return alert("GitHub Token required");
    setBulkProcessing(true);
    const selected = links.filter(l => selectedLinkIds.has(l._id));
    const successIds: string[] = [];
    const errors: string[] = [];

    for (const item of selected) {
      try {
        // Only link comment on PR. Do NOT close issues here.
        await addComment(repoName, token, item.prNumber, `Relates to #${item.issueNumber}\n\n*Linked by RepoAuditor AI*`);
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e); 
        errors.push(`Link ${item.prNumber}<->${item.issueNumber}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to link ${errors.length} items:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    } else if (successIds.length > 0) {
      alert(`Successfully linked ${successIds.length} items.`);
    }

    setLinks(prev => prev.filter(l => !successIds.includes(l._id)));
    setSelectedLinkIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setBulkProcessing(false);
  };

  const executeBulkOperator = async () => {
    if (!julesApiKey) return alert("Jules API Key required");
    setBulkProcessing(true);
    const selected = operatorActions.filter(a => selectedOperatorIds.has(a._id));
    const successIds: string[] = [];
    const errors: string[] = [];
    
    // We need source ID for recreating sessions (Start Over)
    let sourceId = '';
    const needsSource = selected.some(a => a.action === 'start_over');
    if (needsSource) {
      sourceId = await findSourceForRepo(julesApiKey, repoName) || '';
    }

    for (const item of selected) {
      try {
        const shortName = item.sessionName.split('/').pop() || item.sessionName;

        if (item.action === 'delete') {
          await deleteSession(julesApiKey, shortName);
        } else if (item.action === 'message' || item.action === 'recover' || item.action === 'publish') {
           const cmd = item.suggestedCommand || (item.action === 'publish' ? 'Please publish the PR now.' : 'Status check');
           await sendMessage(julesApiKey, shortName, cmd);
        } else if (item.action === 'start_over' && sourceId) {
           await deleteSession(julesApiKey, shortName);
           await createSession(julesApiKey, "Restarting task: Please retry the previous objective with a fresh context.", sourceId, 'leader', `Retry: ${shortName}`);
        }
        successIds.push(item._id);
      } catch (e: any) { 
        console.error(e);
        errors.push(`Session ${item.sessionName.split('/').pop()}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to operate on ${errors.length} sessions:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`);
    } else if (successIds.length > 0) {
      alert(`Successfully executed actions on ${successIds.length} sessions.`);
    }

    setOperatorActions(prev => prev.filter(a => !successIds.includes(a._id)));
    setSelectedOperatorIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
    setBulkProcessing(false);
  };

  const dispatchMergeSession = async (proposal: MergeProposalWithId) => {
    if (!julesApiKey) return alert("Jules API Key required");
    setProcessingProposalId(proposal._id);
    try {
       const sourceId = await findSourceForRepo(julesApiKey, repoName);
       if (!sourceId) throw new Error("Source not found");
       
       const prompt = `Task: Merge the following branches into ${proposal.targetBranch}.\n\nBranches: ${proposal.branches.join(', ')}\n\nGoal: ${proposal.reason}\n\nInstructions:\n1. Git fetch and checkout ${proposal.targetBranch}.\n2. Merge each branch one by one.\n3. If conflicts occur, attempt to resolve them or abort that specific merge.\n4. Run tests after merging.\n5. Push the result.`;
       
       await createSession(julesApiKey, prompt, sourceId, proposal.targetBranch, `Merge Ops: ${proposal.groupName}`);
       alert(`Jules Session dispatched for ${proposal.groupName}`);
       
       setMergeProposals(prev => prev.filter(p => p._id !== proposal._id));
    } catch (e: any) {
      alert(`Failed to dispatch: ${e.message}`);
    } finally {
      setProcessingProposalId(null);
    }
  };

  const toggleAll = (items: { _id: string }[], currentSet: Set<string>, setFunction: (s: Set<string>) => void) => {
    if (currentSet.size === items.length) setFunction(new Set());
    else setFunction(new Set(items.map(i => i._id)));
  };

  const toggleOne = (id: string, currentSet: Set<string>, setFunction: (s: Set<string>) => void) => {
    const next = new Set(currentSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFunction(next);
  };

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Bot className="text-purple-500 w-8 h-8" />
            Repo Agent
          </h2>
          <p className="text-slate-400">Autonomous assistant to suggest work, triage PRs, and manage Jules sessions.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 mb-8 overflow-x-auto no-scrollbar">
        {[
          { id: 'architect', label: 'Architect (Discovery)', icon: Sparkles },
          { id: 'overseer', label: 'Overseer (PR Triage)', icon: AlertTriangle },
          { id: 'janitor', label: 'Janitor (Linking)', icon: Trash2 },
          { id: 'operator', label: 'Operator (Jules)', icon: TerminalSquare },
          { id: 'integrator', label: 'Integrator (Merge Ops)', icon: GitMerge },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={clsx(
              "flex items-center gap-2 px-6 py-4 font-medium transition-colors border-b-2 whitespace-nowrap",
              activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-white"
            )}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* --- ARCHITECT TAB --- */}
      {activeTab === 'architect' && (
        <div className="space-y-6 animate-in fade-in">
           <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6">
             <div className="flex flex-col md:flex-row gap-4 mb-4">
                <div className="flex-1">
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Discovery Mode</label>
                   <select 
                     value={discoveryMode}
                     onChange={(e) => setDiscoveryMode(e.target.value)}
                     className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                   >
                      <option value="strategic">Strategic Gaps (Features & Roadmap)</option>
                      <option value="tech_debt">Technical Debt & Refactoring</option>
                      <option value="quick_win">Quick Wins & Polish</option>
                      <option value="code_reuse">Code Reuse & DRY</option>
                      <option value="dead_code">Dead Code & Cleanup</option>
                      <option value="readability">Readability & Naming</option>
                      <option value="maintainability">Maintainability & Tooling</option>
                   </select>
                </div>
                <div className="flex-[2]">
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">User Guidance (Optional)</label>
                   <div className="flex gap-2">
                     <input 
                       type="text" 
                       value={userGuidance}
                       onChange={(e) => setUserGuidance(e.target.value)}
                       placeholder="e.g. Focus on authentication module..."
                       className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                     />
                   </div>
                </div>
             </div>
             
             <AnalysisCard 
                title="Issue Discovery"
                description="Scan repository for missing features, technical debt, or strategic gaps."
                status={architectAnalysis.status}
                result={null}
                onAnalyze={architectAnalysis.run}
                repoName={repoName}
             />
           </div>

           {/* Pivot Suggestion UI */}
           {pivotSuggestion && (
              <div className="bg-blue-900/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-4">
                 <div className="bg-blue-500/20 p-2 rounded-lg">
                    <Lightbulb className="w-6 h-6 text-blue-400" />
                 </div>
                 <div className="flex-1">
                    <h4 className="text-blue-200 font-bold mb-1">AI Suggestion: Try "{pivotSuggestion.mode}"</h4>
                    <p className="text-sm text-slate-400 mb-3">{pivotSuggestion.reason}</p>
                    <div className="text-xs font-mono bg-slate-900/50 p-2 rounded text-slate-500 mb-3">
                       Proposed Guidance: {pivotSuggestion.guidance}
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleApplyPivot} icon={Play}>Apply Suggestion & Retry</Button>
                 </div>
              </div>
           )}

           {proposedIssues.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input 
                       type="checkbox" 
                       checked={proposedIssues.length > 0 && selectedIssueIds.size === proposedIssues.length}
                       onChange={() => toggleAll(proposedIssues, selectedIssueIds, setSelectedIssueIds)}
                       className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                     />
                     <h3 className="font-semibold text-white">Proposed Issues ({proposedIssues.length})</h3>
                   </div>
                   <Button onClick={executeBulkIssues} disabled={selectedIssueIds.size === 0 || bulkProcessing} isLoading={bulkProcessing} variant="primary" icon={Play}>Create Selected</Button>
                </div>

                <div className="divide-y divide-slate-700">
                  {proposedIssues.map(issue => (
                    <div key={issue._id} className={clsx("p-5 flex gap-4 transition-colors", selectedIssueIds.has(issue._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                       <div className="pt-1">
                          <input type="checkbox" checked={selectedIssueIds.has(issue._id)} onChange={() => toggleOne(issue._id, selectedIssueIds, setSelectedIssueIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                       </div>
                       <div>
                          <h4 className="text-white font-medium mb-1">{issue.title}</h4>
                          <p className="text-slate-400 text-sm mb-3">{issue.reason}</p>
                          <div className="flex flex-wrap gap-2">
                             <Badge variant={issue.priority === 'High' ? 'red' : 'blue'}>{issue.priority}</Badge>
                             <Badge variant="purple">{issue.effort}</Badge>
                             {issue.labels.map(l => <Badge key={l} variant="slate">{l}</Badge>)}
                          </div>
                          <div className="mt-3 p-3 bg-slate-900/50 rounded border border-slate-800 text-xs font-mono text-slate-500 line-clamp-2">
                             {issue.body}
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>
      )}

      {/* --- OVERSEER TAB --- */}
      {activeTab === 'overseer' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard 
              title="PR Triage Audit"
              description="Review open PRs for staleness, redundancy, and quality."
              status={overseerAnalysis.status}
              result={null}
              onAnalyze={overseerAnalysis.run}
              repoName={repoName}
           />

           {prActions.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input 
                       type="checkbox" 
                       checked={prActions.length > 0 && selectedActionIds.size === prActions.length}
                       onChange={() => toggleAll(prActions, selectedActionIds, setSelectedActionIds)}
                       className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                     />
                     <h3 className="font-semibold text-white">Recommended Actions ({prActions.length})</h3>
                   </div>
                   <Button onClick={executeBulkPrActions} disabled={selectedActionIds.size === 0 || bulkProcessing} isLoading={bulkProcessing} variant="primary" icon={Play}>Execute Selected</Button>
                </div>
                
                <div className="divide-y divide-slate-700">
                  {prActions.map(action => (
                    <div key={action._id} className={clsx("p-5 flex gap-4 transition-colors", selectedActionIds.has(action._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                       <div className="pt-1">
                          <input type="checkbox" checked={selectedActionIds.has(action._id)} onChange={() => toggleOne(action._id, selectedActionIds, setSelectedActionIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                       </div>
                       <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-slate-500">#{action.prNumber}</span>
                            <Badge variant={action.action === 'close' ? 'red' : action.action === 'publish' ? 'green' : 'blue'}>{action.action.toUpperCase()}</Badge>
                          </div>
                          <p className="text-slate-300 text-sm mb-2">{action.reason}</p>
                          {action.suggestedComment && (
                             <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-xs text-slate-400 font-mono italic">
                                "{action.suggestedComment}"
                             </div>
                          )}
                       </div>
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>
      )}

      {/* --- JANITOR TAB --- */}
      {activeTab === 'janitor' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard 
              title="Link Discovery & Clean Up"
              description="Find merged PRs that should close open issues, and open PRs that should be linked."
              status={janitorAnalysis.status}
              result={null}
              onAnalyze={janitorAnalysis.run}
              repoName={repoName}
           />

           {links.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input 
                       type="checkbox" 
                       checked={links.length > 0 && selectedLinkIds.size === links.length}
                       onChange={() => toggleAll(links, selectedLinkIds, setSelectedLinkIds)}
                       className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                     />
                     <h3 className="font-semibold text-white">Suggested Links ({links.length})</h3>
                   </div>
                   <Button onClick={executeBulkLinks} disabled={selectedLinkIds.size === 0 || bulkProcessing} isLoading={bulkProcessing} variant="success" icon={LinkIcon}>Link Selected</Button>
                </div>

                <div className="divide-y divide-slate-700">
                  {links.map(link => (
                    <div key={link._id} className={clsx("p-5 flex gap-4 transition-colors", selectedLinkIds.has(link._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                       <div className="pt-1">
                          <input type="checkbox" checked={selectedLinkIds.has(link._id)} onChange={() => toggleOne(link._id, selectedLinkIds, setSelectedLinkIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                       </div>
                       <div className="flex-1 flex flex-col md:flex-row md:items-center gap-4">
                          <div className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700 min-w-[160px]">
                             <div className="flex flex-col">
                                <span className="text-blue-400 font-mono text-xs">PR #{link.prNumber}</span>
                                {link.prState && (
                                   <span className={clsx("text-[10px] uppercase font-bold", link.prState === 'merged' ? 'text-purple-400' : 'text-slate-500')}>
                                      {link.prState}
                                   </span>
                                )}
                             </div>
                             {link.prTitle && <span className="text-xs text-slate-300 truncate max-w-[150px]" title={link.prTitle}>{link.prTitle}</span>}
                          </div>
                          
                          <ArrowRight className="w-4 h-4 text-slate-500 hidden md:block" />
                          
                          <div className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700 min-w-[160px]">
                             <div className="flex flex-col">
                                <span className="text-rose-400 font-mono text-xs">Issue #{link.issueNumber}</span>
                                {link.issueState && (
                                   <span className={clsx("text-[10px] uppercase font-bold", link.issueState === 'open' ? 'text-green-400' : 'text-slate-500')}>
                                      {link.issueState}
                                   </span>
                                )}
                             </div>
                             {link.issueTitle && <span className="text-xs text-slate-300 truncate max-w-[150px]" title={link.issueTitle}>{link.issueTitle}</span>}
                          </div>

                          <div className="flex-1 ml-0 md:ml-4">
                             <p className="text-sm text-slate-300">{link.reason}</p>
                             <div className="flex gap-2 mt-1">
                               <Badge variant="green">{link.confidence} Confidence</Badge>
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

      {/* --- OPERATOR TAB --- */}
      {activeTab === 'operator' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard 
              title="Jules Session Operator"
              description="Monitor active autonomous sessions and recommend next steps (Recover, Publish, Delete)."
              status={operatorAnalysis.status}
              result={null}
              onAnalyze={operatorAnalysis.run}
              repoName={repoName}
           />

           {operatorActions.length > 0 && (
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <input 
                       type="checkbox" 
                       checked={operatorActions.length > 0 && selectedOperatorIds.size === operatorActions.length}
                       onChange={() => toggleAll(operatorActions, selectedOperatorIds, setSelectedOperatorIds)}
                       className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer"
                     />
                     <h3 className="font-semibold text-white">Recommended Actions ({operatorActions.length})</h3>
                   </div>
                   <Button onClick={executeBulkOperator} disabled={selectedOperatorIds.size === 0 || bulkProcessing} isLoading={bulkProcessing} variant="primary" icon={Play}>Execute Selected</Button>
                </div>

                <div className="divide-y divide-slate-700">
                  {operatorActions.map(action => (
                    <div key={action._id} className={clsx("p-5 flex gap-4 transition-colors", selectedOperatorIds.has(action._id) ? "bg-slate-800/40" : "hover:bg-slate-800/20")}>
                       <div className="pt-1">
                          <input type="checkbox" checked={selectedOperatorIds.has(action._id)} onChange={() => toggleOne(action._id, selectedOperatorIds, setSelectedOperatorIds)} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-primary cursor-pointer" />
                       </div>
                       <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-medium">{action.sessionName.split('/').pop()}</span>
                            <Badge 
                              variant={
                                action.action === 'delete' ? 'red' : 
                                action.action === 'publish' ? 'green' : 
                                action.action === 'recover' ? 'yellow' :
                                action.action === 'start_over' ? 'purple' : 'blue'
                              }
                              icon={
                                action.action === 'delete' ? Trash2 : 
                                action.action === 'publish' ? GitMerge : 
                                action.action === 'recover' ? Wrench :
                                action.action === 'start_over' ? RotateCcw : MessageSquare
                              }
                            >
                              {action.action.replace('_', ' ').toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-slate-300 text-sm mb-2">{action.reason}</p>
                          {action.suggestedCommand && (
                             <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-xs text-slate-400 font-mono break-all">
                                $ {action.suggestedCommand}
                             </div>
                          )}
                       </div>
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>
      )}

      {/* --- INTEGRATOR TAB --- */}
      {activeTab === 'integrator' && (
        <div className="space-y-6 animate-in fade-in">
           <AnalysisCard 
              title="Merge Proposals"
              description="Identify conflict-free branch groups ready for merging."
              status={integratorAnalysis.status}
              result={null}
              onAnalyze={integratorAnalysis.run}
              repoName={repoName}
           />

           <div className="grid gap-6">
             {mergeProposals.map(proposal => (
               <div key={proposal._id} className="bg-surface border border-slate-700 rounded-xl overflow-hidden p-6">
                  <div className="flex justify-between items-start mb-4">
                     <div>
                       <h3 className="text-lg font-bold text-white flex items-center gap-2">
                         <GitMerge className="w-5 h-5 text-purple-400" />
                         {proposal.groupName}
                       </h3>
                       <p className="text-slate-400 text-sm mt-1">{proposal.reason}</p>
                     </div>
                     <div className="flex items-center gap-3">
                        <Badge variant={proposal.risk === 'Low' ? 'green' : proposal.risk === 'Medium' ? 'yellow' : 'red'}>{proposal.risk} Risk</Badge>
                        <Button 
                          size="sm" 
                          onClick={() => dispatchMergeSession(proposal)} 
                          isLoading={processingProposalId === proposal._id}
                          disabled={processingProposalId !== null}
                          icon={TerminalSquare}
                        >
                          Dispatch Merger
                        </Button>
                     </div>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                     <div className="text-xs font-bold text-slate-500 uppercase mb-2">Branches to Merge ({proposal.branches.length})</div>
                     <div className="space-y-2">
                       {proposal.branches.map((branch, i) => (
                         <div key={branch} className="flex justify-between items-center text-sm">
                           <span className="font-mono text-blue-300">{branch}</span>
                           <span className="text-slate-500">PR #{proposal.prNumbers[i]}</span>
                         </div>
                       ))}
                     </div>
                     <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center gap-2 text-xs text-slate-500">
                        <ArrowRight className="w-3 h-3" /> Target: <span className="font-mono text-white">{proposal.targetBranch}</span>
                     </div>
                  </div>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
};

export default Agent;
