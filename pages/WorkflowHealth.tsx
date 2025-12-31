
import React, { useState, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw, Terminal, Info, Bug, ShieldAlert, FileWarning, Search, GitPullRequest, GitBranch, History, Bot, ExternalLink, Send, Plus, Check, Zap, Gauge, FileCheck, Layers, Clock, MessageSquareShare, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchWorkflowRuns, fetchWorkflowRunJobs, fetchPrsForCommit, createIssue, fetchWorkflowsContent, fetchCoreRepoContext } from '../services/githubService';
import { analyzeWorkflowHealth, analyzeWorkflowQualitative } from '../services/geminiService';
import { listSessions, sendMessage } from '../services/julesService';
import { GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, AnalysisStatus, GithubPullRequest, JulesSession, WorkflowQualitativeResult } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import AnalysisCard from '../components/AnalysisCard';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface WorkflowHealthProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

interface RunBlameData {
  prs: GithubPullRequest[];
  julesSessions: JulesSession[];
}

const WorkflowHealth: React.FC<WorkflowHealthProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'runs' | 'qualitative'>('runs');
  const [runs, setRuns] = useState<GithubWorkflowRun[]>([]);
  const [jobsMap, setJobsMap] = useState<Record<number, GithubWorkflowJob[]>>({});
  const [blameMap, setBlameMap] = useState<Record<number, RunBlameData>>({});
  const [allActiveSessions, setAllActiveSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState('');
  
  // Track individual run results
  const [runResults, setRunResults] = useState<Record<number, WorkflowHealthResult>>({});
  const [isAnalyzingRuns, setIsAnalyzingRuns] = useState(false);

  // Track dispatching status for each finding
  const [dispatchStatus, setDispatchStatus] = useState<Record<string, 'idle' | 'loading' | 'success'>>({});
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success'>>({});

  const qualitativeAnalysis = useGeminiAnalysis(analyzeWorkflowQualitative, 'workflow_qualitative_v2');

  useEffect(() => {
    if (repoName && token) {
      loadData();
    }
  }, [repoName, token]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadingStep('Fetching workflow runs...');
    try {
      const runData = await fetchWorkflowRuns(repoName, token);
      
      // UNIQUE PAIRS FILTER: Keep only the most recent run for each (Workflow Name + Head Branch) pair
      const uniquePairs = new Set<string>();
      const filteredRuns = runData.filter(run => {
        const pairKey = `${run.name}-${run.head_branch}`;
        if (uniquePairs.has(pairKey)) return false;
        uniquePairs.add(pairKey);
        return true;
      }).slice(0, 5); // Reduced to 5 unique pairs to maximize analysis speed and minimize token overhead

      setRuns(filteredRuns);
      
      setLoadingStep('Correlating job and session data...');
      const newJobsMap: Record<number, GithubWorkflowJob[]> = {};
      const newBlameMap: Record<number, RunBlameData> = {};
      
      // Fetch Jules sessions once for correlation if key exists
      let allJulesSessions: JulesSession[] = [];
      if (julesApiKey) {
        allJulesSessions = await listSessions(julesApiKey);
        setAllActiveSessions(allJulesSessions.filter(s => s.state === 'IN_PROGRESS' || s.state === 'RUNNING' || s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'PENDING'));
      }

      for (const run of filteredRuns) {
        // Parallelize job fetching and PR correlation
        const [jobs, associatedPrs] = await Promise.all([
          fetchWorkflowRunJobs(repoName, run.id, token),
          fetchPrsForCommit(repoName, run.head_sha, token)
        ]);
        
        newJobsMap[run.id] = jobs;

        // Correlate PRs with Jules sessions
        const correlatedJules = allJulesSessions.filter(session => {
          return session.outputs?.some(output => 
            associatedPrs.some(pr => output.pullRequest?.url.includes(`/pull/${pr.number}`))
          );
        });

        newBlameMap[run.id] = {
          prs: associatedPrs,
          julesSessions: correlatedJules
        };
      }
      setJobsMap(newJobsMap);
      setBlameMap(newBlameMap);
    } catch (e) {
      console.error('[WorkflowHealth] Data load error:', e);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzingRuns(true);
    setDispatchStatus({});
    const newResults: Record<number, WorkflowHealthResult> = {};
    
    try {
      // Analyze each run individually for higher fidelity
      const analysisPromises = runs.map(async (run) => {
        const jobs = jobsMap[run.id] || [];
        const res = await analyzeWorkflowHealth(run, jobs);
        newResults[run.id] = res;
      });
      
      await Promise.all(analysisPromises);
      setRunResults(newResults);
    } catch (e) {
      console.error('Run analysis failed', e);
    } finally {
      setIsAnalyzingRuns(false);
    }
  };

  const handleRunQualitativeAnalysis = async () => {
    setDispatchStatus({});
    const [workflows, context] = await Promise.all([
      fetchWorkflowsContent(repoName, token),
      fetchCoreRepoContext(repoName, token)
    ]);
    await qualitativeAnalysis.run(workflows, runs, context);
  };

  const handleDispatchIssue = async (id: string, title: string, body: string, type: string) => {
    if (!token) return;
    setDispatchStatus(prev => ({ ...prev, [id]: 'loading' }));
    try {
      const label = type === 'syntax' ? 'ci:syntax' : type === 'runtime' ? 'ci:error' : type === 'qualitative' ? 'ci:audit' : 'ci:flaky';
      await createIssue(repoName, token, {
        title,
        body: `${body}\n\n---\n*Auto-generated via RepoAuditor CI Health Analysis.*`,
        labels: [label, 'automated-dispatch']
      });
      setDispatchStatus(prev => ({ ...prev, [id]: 'success' }));
    } catch (e: any) {
      alert(`Dispatch failed: ${e.message}`);
      setDispatchStatus(prev => ({ ...prev, [id]: 'idle' }));
    }
  };

  const handleReportToJules = async (id: string, sessionName: string, message: string) => {
    if (!julesApiKey) return;
    const key = `${id}-${sessionName}`;
    setJulesReportStatus(prev => ({ ...prev, [key]: 'loading' }));
    try {
      const shortName = sessionName.split('/').pop() || sessionName;
      await sendMessage(julesApiKey, shortName, `CRITICAL CI FEEDBACK FOR YOUR WORK:\n\n${message}`);
      setJulesReportStatus(prev => ({ ...prev, [key]: 'success' }));
    } catch (e: any) {
      alert(`Failed to report to Jules: ${e.message}`);
      setJulesReportStatus(prev => ({ ...prev, [key]: 'idle' }));
    }
  };

  const currentQualitativeResult = qualitativeAnalysis.result;

  // Aggregate findings from all runs
  const aggregatedFindings = useMemo(() => {
    const syntax: any[] = [];
    const runtime: any[] = [];
    const flakes: any[] = [];
    
    /* FIX: Explicitly cast res as any and then use as WorkflowHealthResult to fix 'Property does not exist on type unknown' errors in Object.values iteration */
    Object.values(runResults).forEach((res: any) => {
      const result = res as WorkflowHealthResult;
      syntax.push(...result.syntaxFailures);
      runtime.push(...result.runtimeErrors);
      flakes.push(...result.falsePositives);
    });
    
    return { syntax, runtime, flakes };
  }, [runResults]);

  const JulesReportMenu = ({ fid, description, sessions }: { fid: string, description: string, sessions: JulesSession[] }) => {
    if (sessions.length === 0) return null;
    
    return (
      <div className="relative group/menu">
        <Button variant="ghost" size="sm" className="h-6 w-8 p-0 text-purple-400 border border-purple-500/20" title="Report to AI Worker">
          <Bot className="w-4 h-4" />
        </Button>
        <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 hidden group-hover/menu:block">
          <div className="p-2 border-b border-slate-700 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Send feedback to Jules</div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {sessions.map(session => {
              const reportKey = `${fid}-${session.name}`;
              const isDone = julesReportStatus[reportKey] === 'success';
              return (
                <button 
                  key={session.name}
                  onClick={() => handleReportToJules(fid, session.name, description)}
                  className="w-full text-left px-3 py-2 text-[10px] text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-between border-b border-slate-800 last:border-0"
                >
                  <span className="truncate pr-2">{session.title || session.name.split('/').pop()}</span>
                  {isDone ? <Check className="w-3 h-3 text-green-500 shrink-0" /> : (
                    julesReportStatus[reportKey] === 'loading' ? <Loader2 className="w-3 h-3 animate-spin text-purple-400 shrink-0" /> : <MessageSquareShare className="w-3 h-3 text-slate-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-cyan-400 w-8 h-8" /> Workflow Pulse
          </h2>
          <p className="text-slate-400">Deep audit of CI health, flakiness, and qualitative efficacy.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => loadData(false)} isLoading={loading} icon={RefreshCw}>Refresh Data</Button>
          {activeTab === 'runs' ? (
            <Button variant="primary" size="sm" onClick={handleRunAnalysis} isLoading={isAnalyzingRuns} icon={Activity}>Deep Audit ({runs.length})</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleRunQualitativeAnalysis} isLoading={qualitativeAnalysis.status === AnalysisStatus.LOADING} icon={Zap} className="bg-purple-600 hover:bg-purple-500 border-purple-400/50">Run Qualitative Audit</Button>
          )}
        </div>
      </div>

      <div className="flex border-b border-slate-700">
        <button 
          onClick={() => setActiveTab('runs')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'runs' ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Operational Health
        </button>
        <button 
          onClick={() => setActiveTab('qualitative')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'qualitative' ? "border-purple-500 text-purple-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Qualitative Audit
        </button>
      </div>

      {activeTab === 'runs' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* RUN HISTORY & JOB BLAME */}
          <div className="lg:col-span-1 space-y-4">
             <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden flex flex-col h-[800px]">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-2">
                     <History className="w-4 h-4 text-slate-500" />
                     <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recent Unique Pairs</span>
                   </div>
                   <Badge variant="slate">{runs.length} Pairs</Badge>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                   {loading && runs.length === 0 ? (
                     <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-xs">{loadingStep}</p>
                     </div>
                   ) : runs.length === 0 ? (
                     <div className="p-12 text-center text-slate-600 italic text-sm">No workflow runs found.</div>
                   ) : runs.map(run => {
                     const blame = blameMap[run.id];
                     const result = runResults[run.id];
                     return (
                     <div 
                       key={run.id} 
                       className={clsx(
                         "block p-4 rounded-xl border transition-all group",
                         result ? "border-cyan-500/30 bg-cyan-500/5" : "border-slate-800 bg-slate-900/40 hover:bg-slate-800/60"
                       )}
                     >
                        <div className="flex justify-between items-start mb-2">
                           <Badge variant={run.conclusion === 'success' ? 'green' : (run.conclusion === 'failure' ? 'red' : 'blue')} className="text-[8px]">
                             {run.conclusion || run.status}
                           </Badge>
                           <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">
                             <ExternalLink className="w-3 h-3" />
                           </a>
                        </div>
                        <h4 className="text-xs font-bold text-slate-200 line-clamp-1 mb-2 group-hover:text-white">{run.name}</h4>
                        
                        <div className="space-y-2 mt-4 pt-4 border-t border-slate-800/50">
                           <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="text-slate-500 flex items-center gap-1"><Terminal className="w-3 h-3" /> SHA</span>
                              <span className="text-cyan-400">{run.head_sha.substring(0, 7)}</span>
                           </div>
                           <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="text-slate-500 flex items-center gap-1"><GitBranch className="w-3 h-3" /> Branch</span>
                              <span className="text-blue-400 truncate max-w-[120px]">{run.head_branch}</span>
                           </div>
                        </div>

                        {result && (
                          <div className="mt-4 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                             <div className="flex items-center gap-2 mb-2">
                               <ShieldAlert className="w-3 h-3 text-cyan-400" />
                               <span className="text-[9px] font-bold text-slate-400 uppercase">AI Diagnosis</span>
                             </div>
                             <div className="text-[10px] text-slate-300 leading-relaxed prose prose-invert prose-xs line-clamp-3">
                               <ReactMarkdown>{result.report}</ReactMarkdown>
                             </div>
                          </div>
                        )}

                        {blame && (blame.prs.length > 0 || blame.julesSessions.length > 0) && (
                          <div className="mt-4 space-y-2">
                             {blame.prs.map(pr => (
                               <div key={pr.number} className="flex items-center gap-2 text-[10px] text-slate-400 bg-slate-950/40 p-1.5 rounded border border-slate-800">
                                  <GitPullRequest className="w-3 h-3 text-purple-400" />
                                  <span className="truncate flex-1">PR #{pr.number}: {pr.title}</span>
                               </div>
                             ))}
                             {blame.julesSessions.map(session => (
                               <div key={session.name} className="flex items-center gap-2 text-[10px] text-blue-300 bg-blue-900/10 p-1.5 rounded border border-blue-900/20">
                                  <Bot className="w-3 h-3 text-blue-400" />
                                  <span className="truncate flex-1">Jules: {session.title || session.name.split('/').pop()}</span>
                               </div>
                             ))}
                          </div>
                        )}
                     </div>
                   )})}
                </div>
             </div>
          </div>

          {/* ANALYSIS VIEW */}
          <div className="lg:col-span-2 space-y-6">
             {isAnalyzingRuns && (
               <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-500 mb-4" />
                  <p className="font-medium text-slate-300">Performing Deep Job Audits...</p>
                  <p className="text-xs mt-2 opacity-60">Analyzing each of the {runs.length} recent environment/branch runs individually.</p>
               </div>
             )}

             {Object.keys(runResults).length === 0 && !isAnalyzingRuns && (
               <div className="bg-surface border border-slate-700 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Search className="w-16 h-16 mb-4 opacity-10" />
                  <h3 className="text-lg font-bold text-slate-400">CI Health Analyzer Ready</h3>
                  <p className="text-sm max-w-xs text-center mt-2">Deploy individual deep analyses for your {runs.length} most recent unique environment runs.</p>
               </div>
             )}

             {Object.keys(runResults).length > 0 && !isAnalyzingRuns && (
               <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
                  {/* Specific Findings Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="bg-red-900/10 border border-red-500/20 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                           <div className="p-2 bg-red-500/10 rounded-lg">
                              <FileWarning className="w-5 h-5 text-red-400" />
                           </div>
                           <h4 className="text-white font-bold text-lg">Syntax Failures</h4>
                        </div>
                        <div className="space-y-4">
                           {aggregatedFindings.syntax.length === 0 ? (
                             <p className="text-sm text-slate-500 italic">No YML syntax failures detected across selected runs.</p>
                           ) : aggregatedFindings.syntax.map((f, i) => {
                             const fid = `syntax-${i}`;
                             return (
                             <div key={fid} className="bg-slate-950/50 border border-red-500/20 rounded-lg p-4 group">
                                <div className="flex justify-between items-start mb-2">
                                  <p className="text-xs font-bold text-red-200">{f.workflowName}</p>
                                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <JulesReportMenu fid={fid} description={`SYNTAX FAILURE: ${f.workflowName}. Reason: ${f.reason}`} sessions={allActiveSessions} />
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-6 px-2 text-[8px] border border-red-500/30 text-red-400 hover:bg-red-500/10"
                                      onClick={() => handleDispatchIssue(fid, f.suggestedTitle, f.suggestedBody, 'syntax')}
                                      isLoading={dispatchStatus[fid] === 'loading'}
                                      disabled={dispatchStatus[fid] === 'success'}
                                    >
                                      {dispatchStatus[fid] === 'success' ? <Check className="w-3 h-3" /> : <><Plus className="w-3 h-3 mr-1" /> Issue</>}
                                    </Button>
                                  </div>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">{f.reason}</p>
                             </div>
                           )})}
                        </div>
                     </div>

                     <div className="bg-amber-900/10 border border-amber-500/20 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                           <div className="p-2 bg-amber-500/10 rounded-lg">
                              <Bug className="w-5 h-5 text-amber-400" />
                           </div>
                           <h4 className="text-white font-bold text-lg">False Positives</h4>
                        </div>
                        <div className="space-y-4">
                           {aggregatedFindings.flakes.length === 0 ? (
                             <p className="text-sm text-slate-500 italic">No flaky patterns identified in recent jobs.</p>
                           ) : aggregatedFindings.flakes.map((fp, i) => {
                             const fpid = `flake-${i}`;
                             return (
                             <div key={fpid} className="bg-slate-950/50 border border-amber-500/20 rounded-lg p-4 group">
                                <div className="flex justify-between items-start mb-2">
                                   <div className="flex flex-col">
                                      <p className="text-xs font-bold text-amber-200">{fp.jobName}</p>
                                      <Badge variant="yellow" className="text-[8px] w-fit mt-1">Flake Index: {fp.flakinessScore}/10</Badge>
                                   </div>
                                   <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <JulesReportMenu fid={fpid} description={`FLAKY PATTERN: ${fp.jobName}. Observation: ${fp.reason}`} sessions={allActiveSessions} />
                                     <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-6 px-2 text-[8px] border border-red-500/30 text-red-400 hover:bg-red-500/10"
                                      onClick={() => handleDispatchIssue(fpid, fp.suggestedTitle, fp.suggestedBody, 'flake')}
                                      isLoading={dispatchStatus[fpid] === 'loading'}
                                      disabled={dispatchStatus[fpid] === 'success'}
                                    >
                                      {dispatchStatus[fpid] === 'success' ? <Check className="w-3 h-3" /> : <><Plus className="w-3 h-3 mr-1" /> Issue</>}
                                    </Button>
                                   </div>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">{fp.reason}</p>
                             </div>
                           )})}
                        </div>
                     </div>
                  </div>

                  {/* Runtime Errors List */}
                  <div className="bg-slate-900/50 border border-slate-700 rounded-2xl overflow-hidden">
                     <div className="p-4 border-b border-slate-700 bg-slate-800/30 flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-purple-400" />
                        <h4 className="text-white font-bold uppercase tracking-widest text-xs">Runtime Job Errors</h4>
                     </div>
                     <div className="divide-y divide-slate-800">
                        {aggregatedFindings.runtime.length === 0 ? (
                           <div className="p-12 text-center text-slate-600 italic text-sm">No specific runtime job errors found across selected unique pairs.</div>
                        ) : aggregatedFindings.runtime.map((err, i) => {
                           const reid = `runtime-${i}`;
                           const runBlame = blameMap[err.runId];
                           const linkedSessions = runBlame?.julesSessions || [];

                           return (
                           <div key={reid} className="p-6 flex gap-6 hover:bg-slate-800/20 transition-colors">
                              <div className="pt-1 flex flex-col items-center gap-3">
                                 <Badge variant={err.confidence === 'high' ? 'red' : 'yellow'}>{err.confidence}</Badge>
                                 <Button 
                                    variant="primary" 
                                    size="sm" 
                                    className="h-8 w-8 p-0"
                                    title="Dispatch Issue to GitHub"
                                    onClick={() => handleDispatchIssue(reid, err.suggestedTitle, err.suggestedBody, 'runtime')}
                                    isLoading={dispatchStatus[reid] === 'loading'}
                                    disabled={dispatchStatus[reid] === 'success'}
                                  >
                                    {dispatchStatus[reid] === 'success' ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                  </Button>

                                  <div className="relative group/worker">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className={clsx("h-8 w-8 p-0 border border-purple-500/30 text-purple-400 hover:bg-purple-500/10")}
                                      title="Report to AI session"
                                    >
                                      <Bot className="w-4 h-4" />
                                    </Button>
                                    <div className="absolute left-full top-0 ml-2 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 hidden group-hover/worker:block">
                                       <div className="p-2 border-b border-slate-700 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Select worker</div>
                                       <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                         {/* Prioritize linked sessions by blame, then show all active ones */}
                                         {[...linkedSessions, ...allActiveSessions.filter(as => !linkedSessions.some(ls => ls.name === as.name))].map(session => {
                                            const reportKey = `${reid}-${session.name}`;
                                            const isDone = julesReportStatus[reportKey] === 'success';
                                            const isLinked = linkedSessions.some(ls => ls.name === session.name);
                                            return (
                                              <button 
                                                key={session.name}
                                                onClick={() => handleReportToJules(reid, session.name, `Job "${err.jobName}" failed in Run #${err.runId}. AI Fingerprint: ${err.errorSnippet}`)}
                                                className="w-full text-left px-3 py-2 text-[10px] text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-between border-b border-slate-800 last:border-0"
                                              >
                                                <div className="flex flex-col min-w-0">
                                                  <span className="truncate pr-2">{session.title || session.name.split('/').pop()}</span>
                                                  {isLinked && <span className="text-[8px] text-blue-400 font-bold uppercase">Linked via blame</span>}
                                                </div>
                                                {isDone ? <Check className="w-3 h-3 text-green-500 shrink-0" /> : (
                                                  julesReportStatus[reportKey] === 'loading' ? <Loader2 className="w-3 h-3 animate-spin text-purple-400 shrink-0" /> : <MessageSquareShare className="w-3 h-3 text-slate-600 shrink-0" />
                                                )}
                                              </button>
                                            );
                                         })}
                                       </div>
                                    </div>
                                  </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                 <h5 className="text-slate-200 font-bold text-sm mb-1">{err.jobName} (Run #{err.runId})</h5>
                                 <div className="bg-slate-950 rounded-lg p-4 mt-3 border border-slate-800">
                                    <div className="flex items-center gap-2 mb-2 text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                                       <Terminal className="w-3 h-3" /> Error Fingerprint
                                    </div>
                                    <pre className="text-[11px] font-mono text-red-300/80 whitespace-pre-wrap overflow-x-auto">{err.errorSnippet}</pre>
                                 </div>
                              </div>
                           </div>
                        )})}
                     </div>
                  </div>
               </div>
             )}
          </div>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in">
           {qualitativeAnalysis.status === AnalysisStatus.LOADING ? (
             <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-12 h-12 animate-spin text-purple-500 mb-4" />
                <p className="font-medium text-slate-300">Auditing Pipeline Qualitative Gaps...</p>
                <p className="text-xs mt-2 opacity-60">Analyzing workflow definitions vs repo structure across {runs.length} unique recent runs.</p>
             </div>
           ) : !currentQualitativeResult ? (
             <div className="bg-surface border border-slate-700 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                <Gauge className="w-16 h-16 mb-4 opacity-10" />
                <h3 className="text-lg font-bold text-slate-400">Qualitative Auditor Ready</h3>
                <p className="text-sm max-w-xs text-center mt-2">Deploy AI to analyze testing efficacy, missing coverage, and redundant triggers.</p>
                <Button variant="primary" size="lg" className="mt-8 bg-purple-600 hover:bg-purple-500" onClick={handleRunQualitativeAnalysis}>Start Qualitative Audit</Button>
             </div>
           ) : (
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Scoring Sidebar */}
                <div className="lg:col-span-1 space-y-6">
                   <div className="bg-surface border border-slate-700 rounded-2xl p-8 shadow-xl">
                      <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Auditor Scorecard</h4>
                      <div className="space-y-10">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                               <div className="p-2 bg-green-500/10 rounded-lg"><Gauge className="w-5 h-5 text-green-400" /></div>
                               <span className="font-bold text-white">Efficacy</span>
                            </div>
                            <span className={clsx("text-2xl font-black", currentQualitativeResult.efficacyScore > 70 ? "text-green-400" : "text-yellow-400")}>{currentQualitativeResult.efficacyScore}%</span>
                         </div>
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                               <div className="p-2 bg-blue-500/10 rounded-lg"><Clock className="w-5 h-5 text-blue-400" /></div>
                               <span className="font-bold text-white">Efficiency</span>
                            </div>
                            <span className={clsx("text-2xl font-black", currentQualitativeResult.efficiencyScore > 70 ? "text-green-400" : "text-yellow-400")}>{currentQualitativeResult.efficiencyScore}%</span>
                         </div>
                      </div>
                      <div className="mt-10 pt-10 border-t border-slate-700">
                         <p className="text-xs text-slate-400 leading-relaxed italic">"{currentQualitativeResult.summary}"</p>
                      </div>
                   </div>

                   {allActiveSessions.length > 0 && (
                     <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Active AI Workers</h4>
                        <div className="space-y-2">
                           {allActiveSessions.map(s => (
                             <div key={s.name} className="flex items-center justify-between p-2 bg-slate-950/40 rounded border border-slate-800">
                                <span className="text-[10px] font-mono text-blue-400 truncate max-w-[150px]">{s.title || s.name.split('/').pop()}</span>
                                <Badge variant="blue" className="text-[8px]">{s.state}</Badge>
                             </div>
                           ))}
                        </div>
                        <p className="mt-4 text-[10px] text-slate-500 italic">Findings below can be dispatched directly to these workers.</p>
                     </div>
                   )}
                </div>

                {/* Findings List */}
                <div className="lg:col-span-2 space-y-4">
                   {currentQualitativeResult.findings.map((f, i) => {
                     const fid = `qual-${i}`;
                     return (
                     <div key={fid} className="bg-surface border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-all p-6 flex gap-6 group">
                        <div className="shrink-0 pt-1">
                           {f.type === 'efficacy' && <FileCheck className="w-6 h-6 text-green-400" />}
                           {f.type === 'coverage' && <Layers className="w-6 h-6 text-red-400" />}
                           {f.type === 'duplicate' && <Layers className="w-6 h-6 text-yellow-400" />}
                           {f.type === 'inefficient' && <Zap className="w-6 h-6 text-blue-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-3">
                                 <h4 className="text-white font-bold">{f.title}</h4>
                                 <Badge variant={f.severity === 'critical' ? 'red' : f.severity === 'moderate' ? 'yellow' : 'slate'} className="text-[8px]">{f.severity}</Badge>
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <JulesReportMenu fid={fid} description={`TECHNICAL AUDIT FINDING: ${f.title}. Description: ${f.description}. Recommendation: ${f.recommendation}`} sessions={allActiveSessions} />
                                 <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 w-8 p-0"
                                  onClick={() => handleDispatchIssue(fid, f.suggestedTitle, f.suggestedBody, 'qualitative')}
                                  isLoading={dispatchStatus[fid] === 'loading'}
                                  disabled={dispatchStatus[fid] === 'success'}
                                  title="Dispatch GitHub Issue"
                                >
                                  {dispatchStatus[fid] === 'success' ? <Check className="w-4 h-4 text-green-500" /> : <Plus className="w-4 h-4" />}
                                </Button>
                              </div>
                           </div>
                           <p className="text-sm text-slate-300 mb-4">{f.description}</p>
                           <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                              <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter block mb-1">Recommendation</span>
                              <p className="text-xs text-blue-300 italic">"{f.recommendation}"</p>
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

export default WorkflowHealth;
