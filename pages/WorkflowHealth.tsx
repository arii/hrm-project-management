
import React, { useState, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw, Terminal, Info, Bug, ShieldAlert, FileWarning, Search, GitPullRequest, GitBranch, History, Bot, ExternalLink, Send, Plus, Check, Zap, Gauge, FileCheck, Layers, Clock, MessageSquareShare, X, CheckSquare } from 'lucide-react';
import { fetchWorkflowRuns, fetchWorkflowRunJobs, fetchPrsForCommit, createIssue, fetchWorkflowsContent, fetchCoreRepoContext } from '../services/githubService';
import { analyzeWorkflowHealth, analyzeWorkflowQualitative } from '../services/geminiService';
import { listSessions, sendMessage } from '../services/julesService';
import { GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, AnalysisStatus, GithubPullRequest, JulesSession, WorkflowQualitativeResult } from '../types';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
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

interface WorkerSelectorState {
  isOpen: boolean;
  findingId: string;
  description: string;
  suggestedSessions: JulesSession[];
}

const WorkflowHealth: React.FC<WorkflowHealthProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'failures' | 'false-positives' | 'qualitative'>('failures');
  
  // Separate states for the two distinct lookup sets
  const [failingRuns, setFailingRuns] = useState<GithubWorkflowRun[]>([]);
  const [successRuns, setSuccessRuns] = useState<GithubWorkflowRun[]>([]);
  
  const [jobsMap, setJobsMap] = useState<Record<number, GithubWorkflowJob[]>>({});
  const [blameMap, setBlameMap] = useState<Record<number, RunBlameData>>({});
  const [allSessions, setAllSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState('');
  
  // Analysis results (unified map by run ID)
  const [runResults, setRunResults] = useState<Record<number, WorkflowHealthResult>>({});
  const [isAnalyzingRuns, setIsAnalyzingRuns] = useState(false);

  // Worker Selection Modal State
  const [workerSelector, setWorkerSelector] = useState<WorkerSelectorState>({
    isOpen: false,
    findingId: '',
    description: '',
    suggestedSessions: []
  });

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
    setLoadingStep('Fetching unique workflow files...');
    try {
      const runData = await fetchWorkflowRuns(repoName, token);
      
      // Ignore skipped runs entirely
      const nonSkipped = runData.filter(run => run.conclusion !== 'skipped');

      // logic: Find 10 unique workflow IDs for FAILURES
      const failingMap = new Map<number, GithubWorkflowRun>();
      for (const run of nonSkipped) {
        if (run.conclusion === 'failure' && !failingMap.has(run.workflow_id) && failingMap.size < 10) {
          failingMap.set(run.workflow_id, run);
        }
      }

      // logic: Find 10 unique workflow IDs for SUCCESS (False Positive Audit)
      const successMap = new Map<number, GithubWorkflowRun>();
      for (const run of nonSkipped) {
        if (run.conclusion === 'success' && !successMap.has(run.workflow_id) && successMap.size < 10) {
          successMap.set(run.workflow_id, run);
        }
      }

      const failingList = Array.from(failingMap.values());
      const successList = Array.from(successMap.values());
      const allActiveRuns = [...failingList, ...successList];

      setFailingRuns(failingList);
      setSuccessRuns(successList);
      
      setLoadingStep('Correlating technical context...');
      const newJobsMap: Record<number, GithubWorkflowJob[]> = {};
      const newBlameMap: Record<number, RunBlameData> = {};
      
      let rawSessions: JulesSession[] = [];
      if (julesApiKey) {
        rawSessions = await listSessions(julesApiKey);
        setAllSessions(rawSessions);
      }

      // Fetch details only for the 20 targeted runs
      for (const run of allActiveRuns) {
        const [jobs, associatedPrs] = await Promise.all([
          fetchWorkflowRunJobs(repoName, run.id, token),
          fetchPrsForCommit(repoName, run.head_sha, token)
        ]);
        
        newJobsMap[run.id] = jobs;

        const correlatedJules = rawSessions.filter(session => {
          const prMatch = session.outputs?.some(output => 
            associatedPrs.some(pr => output.pullRequest?.url.includes(`/pull/${pr.number}`))
          );
          if (prMatch) return true;
          const sessionBranch = session.sourceContext?.githubRepoContext?.startingBranch;
          if (sessionBranch && sessionBranch === run.head_branch) return true;
          return false;
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
    // Determine which runs to analyze based on current tab
    const targetRuns = activeTab === 'failures' ? failingRuns : successRuns;
    
    try {
      const newResults = { ...runResults };
      const analysisPromises = targetRuns.map(async (run) => {
        // Skip if already analyzed this session
        if (newResults[run.id]) return;
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
    await qualitativeAnalysis.run(workflows, [...failingRuns, ...successRuns], context);
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

  const currentVisibleRuns = activeTab === 'failures' ? failingRuns : successRuns;

  const aggregatedFindings = useMemo(() => {
    const syntax: any[] = [];
    const runtime: any[] = [];
    const flakes: any[] = [];
    
    // Aggregate findings only from the runs visible in the current tab
    currentVisibleRuns.forEach(run => {
      const result = runResults[run.id];
      if (result) {
        syntax.push(...result.syntaxFailures);
        runtime.push(...result.runtimeErrors.map(e => ({ ...e, runId: run.id })));
        flakes.push(...result.falsePositives);
      }
    });
    
    return { syntax, runtime, flakes };
  }, [runResults, activeTab, currentVisibleRuns]);

  const openWorkerSelector = (fid: string, description: string, suggestedSessions: JulesSession[]) => {
    setWorkerSelector({
      isOpen: true,
      findingId: fid,
      description,
      suggestedSessions
    });
  };

  const closeWorkerSelector = () => {
    setWorkerSelector(prev => ({ ...prev, isOpen: false }));
  };

  const WorkerSelectorModal = () => {
    if (!workerSelector.isOpen) return null;
    
    const availableSessions = workerSelector.suggestedSessions.length > 0 
      ? workerSelector.suggestedSessions 
      : allSessions.slice(0, 15);

    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={closeWorkerSelector} />
        <div className="relative bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
          <div className="p-6 border-b border-slate-800 bg-slate-800/40 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Bot className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-white font-bold">Select Remediation Worker</h3>
                <p className="text-xs text-slate-500 mt-0.5">Send this finding to an active AI session.</p>
              </div>
            </div>
            <button onClick={closeWorkerSelector} className="text-slate-500 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-slate-900/50">
            {availableSessions.length === 0 ? (
              <div className="p-12 text-center text-slate-600">No active sessions found.</div>
            ) : availableSessions.map(session => {
              const reportKey = `${workerSelector.findingId}-${session.name}`;
              const isDone = julesReportStatus[reportKey] === 'success';
              const isLoading = julesReportStatus[reportKey] === 'loading';
              const isCorrelated = workerSelector.suggestedSessions.some(s => s.name === session.name);

              return (
                <button 
                  key={session.name}
                  disabled={isDone || isLoading}
                  onClick={() => handleReportToJules(workerSelector.findingId, session.name, workerSelector.description)}
                  className={clsx(
                    "w-full text-left px-5 py-4 rounded-xl mb-1 transition-all flex items-center justify-between group/row border",
                    isDone ? "bg-green-500/5 border-green-500/20 cursor-default" : "bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700"
                  )}
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx("font-bold truncate", isDone ? "text-green-400" : "text-slate-200 group-hover/row:text-white")}>
                        {session.title || session.name.split('/').pop()}
                      </span>
                      {isCorrelated && <Badge variant="blue" className="text-[8px] py-0">Correlated</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                      <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {session.name.split('/').pop()}</span>
                      <span className="h-1 w-1 bg-slate-700 rounded-full" />
                      <span className="uppercase font-bold tracking-tighter opacity-70">{session.state}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full transition-colors">
                    {isDone ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : isLoading ? <Loader2 className="w-6 h-6 animate-spin text-purple-400" /> : (
                      <div className="p-2 bg-slate-800 rounded-lg group-hover/row:bg-purple-600 transition-colors">
                        <Send className="w-4 h-4 text-slate-400 group-hover/row:text-white" />
                      </div>
                    )}
                  </div>
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
      <WorkerSelectorModal />
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-cyan-400 w-8 h-8" /> Workflow Pulse
          </h2>
          <p className="text-slate-400">Targeted audit of CI health and hidden flakiness across workflow definitions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => loadData(false)} isLoading={loading} icon={RefreshCw}>Refresh Workflows</Button>
          {activeTab !== 'qualitative' ? (
            <Button variant="primary" size="sm" onClick={handleRunAnalysis} isLoading={isAnalyzingRuns} icon={Activity}>
              Audit {activeTab === 'failures' ? failingRuns.length : successRuns.length} Workflows
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleRunQualitativeAnalysis} isLoading={qualitativeAnalysis.status === AnalysisStatus.LOADING} icon={Zap} className="bg-purple-600 hover:bg-purple-500 border-purple-400/50">Run Qualitative Audit</Button>
          )}
        </div>
      </div>

      <div className="flex border-b border-slate-700">
        <button 
          onClick={() => setActiveTab('failures')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'failures' ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Operational Failures
        </button>
        <button 
          onClick={() => setActiveTab('false-positives')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'false-positives' ? "border-amber-500 text-amber-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          False Positive Review
        </button>
        <button 
          onClick={() => setActiveTab('qualitative')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'qualitative' ? "border-purple-500 text-purple-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Qualitative Audit
        </button>
      </div>

      {activeTab !== 'qualitative' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* RUN HISTORY SIDEBAR */}
          <div className="lg:col-span-1 space-y-4">
             <div className="bg-surface border border-slate-700 rounded-xl flex flex-col h-[800px]">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-2">
                     <History className="w-4 h-4 text-slate-500" />
                     <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                       {activeTab === 'failures' ? 'Failing Workflows' : 'Successful Workflows'}
                     </span>
                   </div>
                   <Badge variant="slate">{currentVisibleRuns.length} Files</Badge>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                   {loading ? (
                     <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-xs">{loadingStep}</p>
                     </div>
                   ) : currentVisibleRuns.length === 0 ? (
                     <div className="p-12 text-center text-slate-600 italic text-sm">No workflow runs found for this criteria.</div>
                   ) : currentVisibleRuns.map(run => {
                     const blame = blameMap[run.id];
                     const result = runResults[run.id];
                     return (
                     <div 
                       key={run.id} 
                       className={clsx(
                         "block p-4 rounded-xl border transition-all group",
                         result ? (activeTab === 'failures' ? "border-cyan-500/30 bg-cyan-500/5" : "border-amber-500/30 bg-amber-500/5") : "border-slate-800 bg-slate-900/40 hover:bg-slate-800/60"
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
                               <ShieldAlert className={clsx("w-3 h-3", activeTab === 'failures' ? "text-cyan-400" : "text-amber-400")} />
                               <span className="text-[9px] font-bold text-slate-400 uppercase">AI Diagnosis</span>
                             </div>
                             <div className="text-[10px] text-slate-300 leading-relaxed prose prose-invert prose-xs line-clamp-3">
                               <ReactMarkdown>{result.report}</ReactMarkdown>
                             </div>
                          </div>
                        )}
                     </div>
                   )})}
                </div>
             </div>
          </div>

          {/* AUDIT OUTPUT */}
          <div className="lg:col-span-2 space-y-6">
             {isAnalyzingRuns && (
               <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-500 mb-4" />
                  <p className="font-medium text-slate-300">Auditing Workflow Context...</p>
                  <p className="text-xs mt-2 opacity-60">Analyzing {currentVisibleRuns.length} unique workflow files individually.</p>
               </div>
             )}

             {aggregatedFindings.syntax.length === 0 && aggregatedFindings.flakes.length === 0 && aggregatedFindings.runtime.length === 0 && !isAnalyzingRuns && (
               <div className="bg-surface border border-slate-700 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Search className="w-16 h-16 mb-4 opacity-10" />
                  <h3 className="text-lg font-bold text-slate-400">CI Auditor Ready</h3>
                  <p className="text-sm max-w-xs text-center mt-2">Deploy AI to analyze the {currentVisibleRuns.length} targeted workflow files for {activeTab === 'failures' ? 'operational errors' : 'hidden flakiness'}.</p>
               </div>
             )}

             {Object.keys(runResults).length > 0 && !isAnalyzingRuns && (
               <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="bg-red-900/10 border border-red-500/20 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                           <div className="p-2 bg-red-500/10 rounded-lg">
                              <FileWarning className="w-5 h-5 text-red-400" />
                           </div>
                           <h4 className="text-white font-bold text-lg">Structural Issues</h4>
                        </div>
                        <div className="space-y-4">
                           {aggregatedFindings.syntax.length === 0 ? (
                             <p className="text-sm text-slate-500 italic">No YML or configuration failures detected.</p>
                           ) : aggregatedFindings.syntax.map((f, i) => {
                             const fid = `syntax-${i}`;
                             return (
                             <div key={fid} className="bg-slate-950/50 border border-red-500/20 rounded-lg p-4 group">
                                <div className="flex justify-between items-start mb-2">
                                  <p className="text-xs font-bold text-red-200">{f.workflowName}</p>
                                  <div className="flex gap-2">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-7 w-8 p-0 border border-purple-500/20 text-purple-400 hover:bg-purple-500/10"
                                      onClick={() => openWorkerSelector(fid, `SYNTAX FAILURE: ${f.workflowName}. Reason: ${f.reason}`, [])}
                                    >
                                      <Bot className="w-4 h-4" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-7 px-2 text-[8px] border border-red-500/30 text-red-400 hover:bg-red-500/10"
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
                           <h4 className="text-white font-bold text-lg">{activeTab === 'failures' ? 'False Positives' : 'Silent Flakes'}</h4>
                        </div>
                        <div className="space-y-4">
                           {aggregatedFindings.flakes.length === 0 ? (
                             <p className="text-sm text-slate-500 italic">No flaky patterns identified in targeted workflows.</p>
                           ) : aggregatedFindings.flakes.map((fp, i) => {
                             const fpid = `flake-${i}`;
                             return (
                             <div key={fpid} className="bg-slate-950/50 border border-amber-500/20 rounded-lg p-4 group">
                                <div className="flex justify-between items-start mb-2">
                                   <div className="flex flex-col">
                                      <p className="text-xs font-bold text-amber-200">{fp.jobName}</p>
                                      <Badge variant="yellow" className="text-[8px] w-fit mt-1">Severity: {fp.flakinessScore}/10</Badge>
                                   </div>
                                   <div className="flex gap-2">
                                     <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-7 w-8 p-0 border border-purple-500/20 text-purple-400 hover:bg-purple-500/10"
                                      onClick={() => openWorkerSelector(fpid, `FLAKY PATTERN: ${fp.jobName}. Observation: ${fp.reason}`, [])}
                                     >
                                      <Bot className="w-4 h-4" />
                                     </Button>
                                     <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-7 px-2 text-[8px] border border-red-500/30 text-red-400 hover:bg-red-500/10"
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

                  {/* Operational Errors List */}
                  <div className="bg-slate-900/50 border border-slate-700 rounded-2xl overflow-hidden">
                     <div className="p-4 border-b border-slate-700 bg-slate-800/30 flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-purple-400" />
                        <h4 className="text-white font-bold uppercase tracking-widest text-xs">Runtime Job Audit</h4>
                     </div>
                     <div className="divide-y divide-slate-800">
                        {aggregatedFindings.runtime.length === 0 ? (
                           <div className="p-12 text-center text-slate-600 italic text-sm">No specific runtime anomalies detected.</div>
                        ) : aggregatedFindings.runtime.map((err, i) => {
                           const reid = `runtime-${i}`;
                           const linkedSessions = blameMap[err.runId]?.julesSessions || [];

                           return (
                           <div key={reid} className="p-6 flex gap-6 hover:bg-slate-800/20 transition-colors">
                              <div className="pt-1 flex flex-col items-center gap-3">
                                 <Badge variant={err.confidence === 'high' ? 'red' : 'yellow'}>{err.confidence}</Badge>
                                 <Button 
                                    variant="primary" 
                                    size="sm" 
                                    className="h-8 w-8 p-0"
                                    onClick={() => handleDispatchIssue(reid, err.suggestedTitle, err.suggestedBody, 'runtime')}
                                    isLoading={dispatchStatus[reid] === 'loading'}
                                    disabled={dispatchStatus[reid] === 'success'}
                                  >
                                    {dispatchStatus[reid] === 'success' ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-8 w-8 p-0 border border-purple-500/20 text-purple-400 hover:bg-purple-500/10"
                                    onClick={() => openWorkerSelector(reid, `CI FINDING: Job "${err.jobName}" at Run #${err.runId}. AI Diagnostic: ${err.errorSnippet}`, linkedSessions)}
                                  >
                                    <Bot className="w-4 h-4" />
                                  </Button>
                              </div>
                              <div className="flex-1 min-w-0">
                                 <h5 className="text-slate-200 font-bold text-sm mb-1">{err.jobName} (Run ID: {err.runId})</h5>
                                 <div className="bg-slate-950 rounded-lg p-4 mt-3 border border-slate-800">
                                    <div className="flex items-center gap-2 mb-2 text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                                       <Terminal className="w-3 h-3" /> Technical Fingerprint
                                    </div>
                                    <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto">{err.errorSnippet}</pre>
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
                <p className="text-xs mt-2 opacity-60">Comparing workflow definitions against repository structure.</p>
             </div>
           ) : !currentQualitativeResult ? (
             <div className="bg-surface border border-slate-700 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                <Gauge className="w-16 h-16 mb-4 opacity-10" />
                <h3 className="text-lg font-bold text-slate-400">Qualitative Auditor Ready</h3>
                <p className="text-sm max-w-xs text-center mt-2">Evaluate testing efficacy, missing coverage, and redundant triggers across the entire repo.</p>
                <Button variant="primary" size="lg" className="mt-8 bg-purple-600 hover:bg-purple-500" onClick={handleRunQualitativeAnalysis}>Start Qualitative Audit</Button>
             </div>
           ) : (
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                </div>

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
                              <div className="flex gap-2">
                                 <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 w-8 p-0 border border-purple-500/20 text-purple-400 hover:bg-purple-500/10"
                                  onClick={() => openWorkerSelector(fid, `QUALITATIVE AUDIT: ${f.title}. Recommendation: ${f.recommendation}`, [])}
                                 >
                                  <Bot className="w-4 h-4" />
                                 </Button>
                                 <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 w-8 p-0"
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
