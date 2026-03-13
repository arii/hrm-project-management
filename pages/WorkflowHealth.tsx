
import React, { useState, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw, Terminal, Info, Bug, ShieldAlert, FileWarning, Search, GitPullRequest, GitBranch, History, Bot, ExternalLink, Send, Plus, Check, Zap, Gauge, FileCheck, Layers, Clock, MessageSquareShare, X, CheckSquare, Play, Link2, User, Cpu, Code2, AlertOctagon, Key } from 'lucide-react';
import { fetchWorkflowRuns, fetchWorkflowRunJobs, fetchWorkflowRun, createIssue, fetchWorkflowsContent, fetchCoreRepoContext, fetchJobAnnotations } from '../services/githubService';
import { analyzeWorkflowHealth, analyzeWorkflowQualitative } from '../services/geminiService';
import { listSessions, sendMessage } from '../services/julesService';
import { GithubWorkflowRun, GithubWorkflowJob, WorkflowHealthResult, AnalysisStatus, GithubPullRequest, JulesSession, WorkflowQualitativeResult, GithubAnnotation } from '../types';
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

interface ManualPreview {
  run: GithubWorkflowRun;
  jobs: GithubWorkflowJob[];
  annotations: Record<number, GithubAnnotation[]>;
  repo: string;
}

const WorkflowHealth: React.FC<WorkflowHealthProps> = ({ repoName, token, julesApiKey }) => {
  const [activeTab, setActiveTab] = useState<'failures' | 'false-positives' | 'qualitative'>('failures');
  
  const [failingRuns, setFailingRuns] = useState<GithubWorkflowRun[]>([]);
  const [successRuns, setSuccessRuns] = useState<GithubWorkflowRun[]>([]);
  
  const [jobsMap, setJobsMap] = useState<Record<number, GithubWorkflowJob[]>>({});
  const [blameMap, setBlameMap] = useState<Record<number, RunBlameData>>({});
  const [allSessions, setAllSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState('');
  
  const [runResults, setRunResults] = useState<Record<number, WorkflowHealthResult>>({});
  const [isAnalyzingRuns, setIsAnalyzingRuns] = useState(false);

  const [manualUrl, setManualUrl] = useState('');
  const [manualPreview, setManualPreview] = useState<ManualPreview | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [isManualLoading, setIsManualLoading] = useState(false);

  const [workerSelector, setWorkerSelector] = useState<WorkerSelectorState>({
    isOpen: false,
    findingId: '',
    description: '',
    suggestedSessions: []
  });

  const [dispatchStatus, setDispatchStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const qualitativeAnalysis = useGeminiAnalysis(analyzeWorkflowQualitative, 'workflow_qualitative_v2');

  useEffect(() => {
    if (repoName && token) {
      loadData(false, false);
    }
  }, [repoName, token]);

  const loadData = async (silent = false, skipCache = false) => {
    if (!silent) setLoading(true);
    setLoadingStep('Collecting exactly 15 recent failures and successes...');
    
    const failingList: GithubWorkflowRun[] = [];
    const successList: GithubWorkflowRun[] = [];
    
    try {
      let currentPage = 1;
      const MAX_PAGES = 15; 
      
      while (currentPage <= MAX_PAGES && (failingList.length < 15 || successList.length < 15)) {
        setLoadingStep(`Scanning history (page ${currentPage})...`);
        const runData = await fetchWorkflowRuns(repoName, token, skipCache, currentPage);
        
        if (runData.length === 0) break;

        for (const run of runData) {
          if (run.status !== 'completed') continue;
          
          if ((run.conclusion === 'failure' || run.conclusion === 'timed_out') && failingList.length < 15) {
            failingList.push(run);
          }
          
          if (run.conclusion === 'success' && successList.length < 15) {
            successList.push(run);
          }
        }

        currentPage++;
      }

      setFailingRuns(failingList);
      setSuccessRuns(successList);
      
      setLoadingStep('Correlating session data...');
      const newJobsMap: Record<number, GithubWorkflowJob[]> = {};
      const newBlameMap: Record<number, RunBlameData> = {};
      
      let rawSessions: JulesSession[] = [];
      if (julesApiKey) {
        rawSessions = await listSessions(julesApiKey).catch(() => []);
        setAllSessions(rawSessions);
      }

      const allActiveRuns = [...failingList, ...successList];

      for (const run of allActiveRuns) {
        const jobs = await fetchWorkflowRunJobs(repoName, run.id, token).catch(() => []);
        const associatedPrs: GithubPullRequest[] = []; // PR correlation disabled for performance
        
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

  const handleManualAudit = async () => {
    if (!manualUrl.trim() || !token) return;
    setManualError(null);
    setManualPreview(null);
    
    // Support standard Run URLs and Job-specific URLs
    const match = manualUrl.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
    if (!match) {
      setManualError("Invalid URL format. Expected: github.com/owner/repo/actions/runs/ID");
      return;
    }

    const targetRepo = match[1];
    const runId = parseInt(match[2], 10);

    setIsManualLoading(true);
    setLoadingStep('Establishing link with GitHub API...');
    
    try {
      const run = await fetchWorkflowRun(targetRepo, runId, token);
      setLoadingStep(`Target Acquired: ${run.name} (#${run.run_number}). Enumerating jobs...`);
      
      const jobs = await fetchWorkflowRunJobs(targetRepo, runId, token);
      setLoadingStep(`Analyzed ${jobs.length} jobs. Probing for technical annotations...`);

      // Parallel fetch annotations for all failed jobs to keep early feedback fast
      const failingJobs = jobs.filter(j => j.conclusion === 'failure' || j.conclusion === 'timed_out');
      const annotations: Record<number, GithubAnnotation[]> = {};
      
      if (failingJobs.length > 0) {
        const annotationResults = await Promise.all(
          failingJobs.map(job => fetchJobAnnotations(targetRepo, job.id, token).catch(() => []))
        );
        failingJobs.forEach((job, idx) => {
          if (annotationResults[idx].length > 0) {
            annotations[job.id] = annotationResults[idx];
          }
        });
      }

      // SET PREVIEW IMMEDIATELY TO GIVE USER EARLY FEEDBACK
      setManualPreview({ run, jobs, annotations, repo: targetRepo });
      setLoadingStep('Context loaded. AI Auditor initiating deep reasoning scan...');
      
      const result = await analyzeWorkflowHealth(run, jobs, annotations);
      
      setRunResults(prev => ({ ...prev, [run.id]: result }));
      setJobsMap(prev => ({ ...prev, [run.id]: jobs }));
      
      // Auto-switch tab based on result
      if (run.conclusion === 'success') {
        setSuccessRuns(prev => [run, ...prev.filter(r => r.id !== run.id)].slice(0, 15));
        setActiveTab('false-positives');
      } else {
        setFailingRuns(prev => [run, ...prev.filter(r => r.id !== run.id)].slice(0, 15));
        setActiveTab('failures');
      }

      setManualUrl('');
      // Keep manualPreview visible for a split second or clear it if we switched tabs
      setTimeout(() => setManualPreview(null), 500);
    } catch (e: any) {
      console.error('[ManualAudit] Error:', e);
      setManualError(`Link Failed: ${e.message}. Ensure the token has 'actions' read access.`);
    } finally {
      setIsManualLoading(false);
      setLoadingStep('');
    }
  };

  const handleRunAnalysis = async () => {
    if (isAnalyzingRuns) return;
    setIsAnalyzingRuns(true);
    const targetRuns = activeTab === 'failures' ? failingRuns : successRuns;
    
    try {
      const newResults = { ...runResults };
      // Audit in parallel chunks
      const analysisPromises = targetRuns.map(async (run) => {
        if (newResults[run.id]) return;
        const jobs = jobsMap[run.id] || [];
        const annotations: Record<number, GithubAnnotation[]> = {};
        
        // Background fetch annotations for failure runs during bulk audit
        if (run.conclusion === 'failure') {
          const failingJobs = jobs.filter(j => j.conclusion === 'failure');
          const results = await Promise.all(failingJobs.map(j => fetchJobAnnotations(repoName, j.id, token).catch(() => [])));
          failingJobs.forEach((j, i) => { if (results[i].length > 0) annotations[j.id] = results[i]; });
        }

        const res = await analyzeWorkflowHealth(run, jobs, annotations);
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
      console.error(`Dispatch failed: ${e.message}`);
      setDispatchStatus(prev => ({ ...prev, [id]: 'error' }));
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
      console.error(`Failed to report to Jules: ${e.message}`);
      setJulesReportStatus(prev => ({ ...prev, [key]: 'error' }));
    }
  };

  const currentQualitativeResult = qualitativeAnalysis.result;
  const currentVisibleRuns = activeTab === 'failures' ? failingRuns : successRuns;

  const aggregatedFindings = useMemo(() => {
    const syntax: any[] = [];
    const runtime: any[] = [];
    const flakes: any[] = [];
    
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
    
    const suggestedIds = new Set(workerSelector.suggestedSessions.map(s => s.name));
    const otherRecentSessions = allSessions.filter(s => !suggestedIds.has(s.name));
    const availableSessions = [...workerSelector.suggestedSessions, ...otherRecentSessions].slice(0, 40);

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
                <h3 className="text-white font-bold">Remediation Worker</h3>
                <p className="text-xs text-slate-500 mt-0.5">Select a recent Jules session to receive this audit finding.</p>
              </div>
            </div>
            <button onClick={closeWorkerSelector} className="text-slate-500 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-slate-900/50">
            {availableSessions.length === 0 ? (
              <div className="p-12 text-center text-slate-600">No recent sessions found.</div>
            ) : availableSessions.map(session => {
              const reportKey = `${workerSelector.findingId}-${session.name}`;
              const isDone = julesReportStatus[reportKey] === 'success';
              const isLoading = julesReportStatus[reportKey] === 'loading';
              const isError = julesReportStatus[reportKey] === 'error';
              const isCorrelated = suggestedIds.has(session.name);

              return (
                <button 
                  key={session.name}
                  disabled={isDone || isLoading}
                  onClick={() => handleReportToJules(workerSelector.findingId, session.name, workerSelector.description)}
                  className={clsx(
                    "w-full text-left px-5 py-4 rounded-xl mb-1 transition-all flex items-center justify-between group/row border",
                    isDone ? "bg-green-500/5 border-green-500/20 cursor-default" : 
                    isError ? "bg-red-500/5 border-red-500/20" :
                    "bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700"
                  )}
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx("font-bold truncate", isDone ? "text-green-400" : isError ? "text-red-400" : "text-slate-200 group-hover/row:text-white")}>
                        {session.title || session.name.split('/').pop()}
                      </span>
                      {isCorrelated && <Badge variant="blue" className="text-[8px] py-0">Correlated</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                      <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {session.name.split('/').pop()}</span>
                      <span className="h-1 w-1 bg-slate-700 rounded-full" />
                      <span className={clsx("uppercase font-bold tracking-tighter opacity-80", 
                        session.state === 'COMPLETED' || session.state === 'SUCCEEDED' ? "text-green-500/60" : 
                        session.state === 'FAILED' ? "text-red-500/60" : "text-slate-500"
                      )}>{session.state}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full transition-colors">
                    {isDone ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : isError ? <AlertTriangle className="w-6 h-6 text-red-500" /> : isLoading ? <Loader2 className="w-6 h-6 animate-spin text-purple-400" /> : (
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
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-cyan-400 w-8 h-8" /> Workflow Pulse
          </h2>
          <p className="text-slate-400">Auditing history and targeted runs via deep technical inspection.</p>
        </div>
        <div className="flex flex-col md:flex-row items-end gap-3 w-full md:w-auto">
          <div className="flex flex-col w-full md:w-96">
            <div className="flex group">
               <div className="relative flex-1">
                 <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                 <input 
                   type="text" 
                   value={manualUrl}
                   onChange={(e) => { setManualUrl(e.target.value); setManualError(null); }}
                   onKeyDown={(e) => e.key === 'Enter' && handleManualAudit()}
                   placeholder="Audit via URL (Run or Job)..."
                   className={clsx(
                     "w-full bg-slate-900 border rounded-l-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none transition-colors",
                     manualError ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-primary"
                   )}
                 />
               </div>
               <Button 
                 variant="primary" 
                 size="sm" 
                 onClick={handleManualAudit} 
                 isLoading={isManualLoading} 
                 className="rounded-l-none"
                 disabled={!manualUrl.trim()}
               >
                 Audit Target
               </Button>
            </div>
            {manualError && <p className="text-[10px] text-red-400 mt-1.5 font-bold animate-in slide-in-from-top-1">{manualError}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => loadData(false, true)} isLoading={loading} icon={RefreshCw}>Refresh</Button>
            {activeTab !== 'qualitative' ? (
              <Button variant="primary" size="sm" onClick={handleRunAnalysis} isLoading={isAnalyzingRuns} icon={Activity}>
                Audit {currentVisibleRuns.length} Runs
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleRunQualitativeAnalysis} isLoading={qualitativeAnalysis.status === AnalysisStatus.LOADING} icon={Zap} className="bg-purple-600 hover:bg-purple-500 border-purple-400/50">Run Qualitative Audit</Button>
            )}
          </div>
        </div>
      </div>

      {isManualLoading && manualPreview && (
        <div className="bg-blue-900/10 border border-blue-500/20 rounded-xl p-6 flex flex-col md:flex-row items-center gap-8 animate-in zoom-in-95 duration-300">
           <div className="shrink-0 flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/20 text-blue-400">
              <Loader2 className="w-8 h-8 animate-spin" />
           </div>
           <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                 <h3 className="text-white font-bold text-lg truncate">Target Identified: {manualPreview.run.name}</h3>
                 <Badge variant={manualPreview.run.conclusion === 'success' ? 'green' : 'red'}>{manualPreview.run.conclusion || 'Running'}</Badge>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                 <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Run #{manualPreview.run.run_number}</span>
                 <span className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> {manualPreview.run.head_branch}</span>
                 <span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> {manualPreview.jobs.length} Jobs Scan</span>
              </div>
              
              {/* Early Feedback: Technical Findings */}
              <div className="mt-4 pt-4 border-t border-blue-500/20">
                 <div className="flex items-center gap-2 mb-3">
                    <Code2 className="w-4 h-4 text-blue-400" />
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Early Technical Fingerprints</span>
                 </div>
                 <div className="flex flex-wrap gap-2">
                    {/* Fix: Explicitly cast flattened annotations to fix 'unknown' type error */}
                    {(Object.values(manualPreview.annotations).flat() as GithubAnnotation[]).length > 0 ? (
                      (Object.values(manualPreview.annotations).flat() as GithubAnnotation[]).slice(0, 5).map((a, i) => (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-300 font-mono">
                           <AlertTriangle className="w-3 h-3 text-red-400" />
                           <span className="truncate max-w-[200px]">{a.title || a.message}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-[10px] text-slate-500 italic">No automated annotations found. Inspecting logs...</div>
                    )}
                 </div>
              </div>

              <p className="text-[11px] text-blue-400 font-mono mt-4 uppercase tracking-tighter animate-pulse">{loadingStep}</p>
           </div>
        </div>
      )}

      <div className="flex border-b border-slate-700">
        <button 
          onClick={() => setActiveTab('failures')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'failures' ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Recent Failures
        </button>
        <button 
          onClick={() => setActiveTab('false-positives')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'false-positives' ? "border-amber-500 text-amber-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Successes & Flakes
        </button>
        <button 
          onClick={() => setActiveTab('qualitative')} 
          className={clsx("px-6 py-3 font-medium transition-all border-b-2", activeTab === 'qualitative' ? "border-purple-500 text-purple-400" : "border-transparent text-slate-500 hover:text-slate-300")}
        >
          Qualitative Audit
        </button>
      </div>

      {(!repoName || !token) ? (
        <div className="bg-surface border border-amber-800/50 rounded-xl p-12 text-center animate-in fade-in zoom-in-95">
          <Key className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-amber-200 mb-2">Credentials Required</h3>
          <p className="text-amber-300/70 max-w-md mx-auto">Configure your repository name and GitHub personal access token in Settings to monitor workflow health.</p>
        </div>
      ) : activeTab !== 'qualitative' ? (
        <div className="flex flex-col-reverse lg:flex-row lg:grid lg:grid-cols-3 gap-8">
          {/* RUN HISTORY SIDEBAR */}
          <div className="lg:col-span-1 space-y-4">
             <div className="bg-surface border border-slate-700 rounded-xl flex flex-col h-[800px]">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                   <div className="flex items-center gap-2">
                     <History className="w-4 h-4 text-slate-500" />
                     <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                       {activeTab === 'failures' ? 'Failure Runs' : 'Success Runs'}
                     </span>
                   </div>
                   <Badge variant="slate">{currentVisibleRuns.length} Total</Badge>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                   {loading ? (
                     <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-xs">{loadingStep}</p>
                     </div>
                   ) : currentVisibleRuns.length === 0 ? (
                     <div className="p-12 text-center text-slate-600 italic text-sm">No workflow runs found in this criteria.</div>
                   ) : currentVisibleRuns.map(run => {
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
                           <Badge variant={run.conclusion === 'success' ? 'green' : (run.conclusion === 'failure' || run.conclusion === 'timed_out' ? 'red' : 'blue')} className="text-[8px]">
                             {run.conclusion || run.status}
                           </Badge>
                           <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">
                             <ExternalLink className="w-3 h-3" />
                           </a>
                        </div>
                        <h4 className="text-xs font-bold text-slate-200 line-clamp-1 mb-2 group-hover:text-white">{run.name}</h4>
                        
                        <div className="space-y-2 mt-4 pt-4 border-t border-slate-800/50">
                           <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="text-slate-500 flex items-center gap-1"><Terminal className="w-3 h-3" /> Run ID</span>
                              <span className="text-cyan-400">{run.id}</span>
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
             {(isAnalyzingRuns || (isManualLoading && !manualPreview)) && (
               <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-500 mb-4" />
                  <p className="font-medium text-slate-300">{isManualLoading ? 'Linking GitHub Workflow Context...' : 'Auditing History...'}</p>
                  <p className="text-xs mt-2 opacity-60">Deep analysis of jobs, steps, and technical annotations.</p>
               </div>
             )}

             {isManualLoading && manualPreview && (
                <div className="bg-surface border border-slate-700 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500 animate-pulse">
                  <Bot className="w-12 h-12 text-cyan-500 mb-4" />
                  <p className="font-medium text-slate-300">AI Reasoning Engine Scanning Run...</p>
                  <p className="text-xs mt-2 opacity-60 max-w-xs text-center">Correlating found error fingerprints with workflow definition to determine root cause.</p>
                </div>
             )}

             {!isAnalyzingRuns && !isManualLoading && aggregatedFindings.syntax.length === 0 && aggregatedFindings.flakes.length === 0 && aggregatedFindings.runtime.length === 0 && (
               <div className="bg-surface border border-slate-700 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center text-slate-500">
                  <Search className="w-16 h-16 mb-4 opacity-10" />
                  <h3 className="text-lg font-bold text-slate-400">CI Auditor Ready</h3>
                  <p className="text-sm max-w-xs text-center mt-2">Paste a URL above or deploy AI to analyze the {currentVisibleRuns.length} most recent workflow runs in this set.</p>
                  <Button variant="primary" onClick={handleRunAnalysis} icon={Play} className="mt-6" disabled={currentVisibleRuns.length === 0}>Run Deep Audit</Button>
               </div>
             )}

             {Object.keys(runResults).length > 0 && !isAnalyzingRuns && !isManualLoading && (
               <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {activeTab === 'failures' && (
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
                      const status = dispatchStatus[fid];
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
                              className={clsx(
                                "h-7 px-2 text-[8px] border transition-colors",
                                status === 'success' ? "border-green-500/30 text-green-400 bg-green-500/5" : 
                                status === 'error' ? "border-red-500/50 text-red-400 bg-red-500/10" :
                                "border-red-500/30 text-red-400 hover:bg-red-500/10"
                              )}
                              onClick={() => handleDispatchIssue(fid, f.suggestedTitle, f.suggestedBody, 'syntax')}
                              isLoading={status === 'loading'}
                              disabled={status === 'success'}
                            >
                              {status === 'success' ? <Check className="w-3 h-3" /> : status === 'error' ? 'Error' : <><Plus className="w-3 h-3 mr-1" /> Issue</>}
                            </Button>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{f.reason}</p>
                      </div>
                    )})}
                  </div>
                </div>
              )}

                     <div className="bg-amber-900/10 border border-amber-500/20 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                           <div className="p-2 bg-amber-500/10 rounded-lg">
                              <Bug className="w-5 h-5 text-amber-400" />
                           </div>
                           <h4 className="text-white font-bold text-lg">{activeTab === 'failures' ? 'False Positives' : 'Silent Flakes'}</h4>
                        </div>
                        <div className="space-y-4">
                           {aggregatedFindings.flakes.length === 0 ? (
                             <p className="text-sm text-slate-500 italic">No flaky patterns identified in recent runs.</p>
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
                                      className={clsx(
                                        "h-7 px-2 text-[8px] border transition-colors",
                                        dispatchStatus[fpid] === 'success' ? "border-green-500/30 text-green-400 bg-green-500/5" : 
                                        dispatchStatus[fpid] === 'error' ? "border-red-500/50 text-red-400 bg-red-500/10" :
                                        "border-red-500/30 text-red-400 hover:bg-red-500/10"
                                      )}
                                      onClick={() => handleDispatchIssue(fpid, fp.suggestedTitle, fp.suggestedBody, 'flake')}
                                      isLoading={dispatchStatus[fpid] === 'loading'}
                                      disabled={dispatchStatus[fpid] === 'success'}
                                    >
                                      {dispatchStatus[fpid] === 'success' ? <Check className="w-3 h-3" /> : dispatchStatus[fpid] === 'error' ? 'Error' : <><Plus className="w-3 h-3 mr-1" /> Issue</>}
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
                        <h4 className="text-white font-bold uppercase tracking-widest text-xs">Technical Job Audit</h4>
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
                                    className={clsx(
                                      "h-8 w-8 p-0 transition-colors",
                                      dispatchStatus[reid] === 'success' ? "bg-green-500/20 border-green-500/30" : 
                                      dispatchStatus[reid] === 'error' ? "bg-red-500/20 border-red-500/30" : ""
                                    )}
                                    onClick={() => handleDispatchIssue(reid, err.suggestedTitle, err.suggestedBody, 'runtime')}
                                    isLoading={dispatchStatus[reid] === 'loading'}
                                    disabled={dispatchStatus[reid] === 'success'}
                                  >
                                    {dispatchStatus[reid] === 'success' ? <Check className="w-4 h-4 text-green-500" /> : dispatchStatus[reid] === 'error' ? <XCircle className="w-4 h-4 text-red-500" /> : <Plus className="w-4 h-4" />}
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
