import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ExternalLink, 
  RefreshCw, 
  Search, 
  Shield, 
  Zap,
  FileText,
  MessageSquare,
  Github,
  Send,
  AlertTriangle,
  Info
} from 'lucide-react';
import { GithubWorkflowRun, GithubWorkflowJob, GithubAnnotation, WorkflowAnalysis } from '../types';
import * as github from '../services/githubService';
import * as gemini from '../services/geminiService';
import { storage } from '../services/storageService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import CredentialsRequired from '../components/ui/CredentialsRequired';
import WorkerSelectorModal from '../components/ui/WorkerSelectorModal';
import { useManualAudit } from '../hooks/useManualAudit';
import { useIssueDispatch } from '../hooks/useIssueDispatch';
import { useJulesSessions } from '../hooks/useJulesSessions';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WorkflowHealthProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

export default function WorkflowHealth({ repoName, token, julesApiKey }: WorkflowHealthProps) {
  const [repo] = useState(repoName || storage.getRepo() || '');
  const [githubToken] = useState(token || storage.getGithubToken() || '');
  const [geminiKey] = useState(storage.getGeminiKey() || '');
  
  const [runs, setRuns] = useState<GithubWorkflowRun[]>([]);
  const [jobsMap, setJobsMap] = useState<Record<number, GithubWorkflowJob[]>>({});
  const [annotationsMap, setAnnotationsMap] = useState<Record<number, GithubAnnotation[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [analysis, setAnalysis] = useState<WorkflowAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Hooks
  const {
    manualUrl,
    setManualUrl,
    manualPreview,
    setManualPreview,
    manualError,
    isManualLoading,
    loadingStep,
    handleManualAudit
  } = useManualAudit(githubToken);

  const {
    isDispatching,
    dispatchIssue
  } = useIssueDispatch(repo, token);

  const {
    allSessions,
    suggestedSessions,
    julesReportStatus,
    onReportToJules
  } = useJulesSessions(julesApiKey, repo);

  const [workerModal, setWorkerModal] = useState<{
    isOpen: boolean;
    finding: any | null;
  }>({ isOpen: false, finding: null });

  const hasCredentials = repo && token && geminiKey;

  const loadWorkflowData = useCallback(async () => {
    if (!repo || !token) return;
    
    setIsLoading(true);
    setError(null);
    try {
      // Fetch recent failing runs (limit to 20 for performance)
      const recentRuns = await github.fetchWorkflowRuns(repo, token, true, 1, 'failure');
      const limitedRuns = recentRuns.slice(0, 20);
      setRuns(limitedRuns);

      // Batch fetch jobs for these runs
      const jobsResults = await Promise.all(
        limitedRuns.map(run => github.fetchWorkflowRunJobs(repo, run.id, token))
      );

      const newJobsMap: Record<number, GithubWorkflowJob[]> = {};
      const annotationPromises: Promise<any>[] = [];

      limitedRuns.forEach((run, index) => {
        const jobs = jobsResults[index];
        newJobsMap[run.id] = jobs;
        
        // Collect annotation promises for failed jobs
        jobs.forEach(job => {
          if (job.conclusion === 'failure') {
            annotationPromises.push(
              github.fetchJobAnnotations(repo, job.id, token).then(ann => ({ jobId: job.id, annotations: ann }))
            );
          }
        });
      });

      setJobsMap(newJobsMap);

      // Batch fetch annotations
      const annotationsResults = await Promise.all(annotationPromises);
      const newAnnotationsMap: Record<number, GithubAnnotation[]> = {};
      annotationsResults.forEach(res => {
        newAnnotationsMap[res.jobId] = res.annotations;
      });
      setAnnotationsMap(newAnnotationsMap);

    } catch (err: any) {
      setError(err.message || 'Failed to load workflow data');
    } finally {
      setIsLoading(false);
    }
  }, [repo, token]);

  useEffect(() => {
    if (hasCredentials) {
      loadWorkflowData();
    }
  }, [hasCredentials, loadWorkflowData]);

  const runAnalysis = async () => {
    if (!runs.length || !geminiKey) return;
    
    setIsAnalyzing(true);
    try {
      // Prepare context for AI
      const context = runs.map(run => {
        const jobs = jobsMap[run.id] || [];
        return {
          id: run.id,
          name: run.name,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          jobs: jobs.map(j => ({
            name: j.name,
            conclusion: j.conclusion,
            annotations: annotationsMap[j.id] || []
          }))
        };
      });

      const result = await gemini.analyzeWorkflowBatch(repo, context, geminiKey);
      setAnalysis(result);
    } catch (err: any) {
      console.error('Analysis failed:', err);
      setError('AI Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openWorkerModal = (finding: any) => {
    setWorkerModal({ isOpen: true, finding });
  };

  if (!hasCredentials) {
    return <CredentialsRequired />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <Activity className="w-8 h-8 text-indigo-600" />
            Workflow Health Audit
          </h1>
          <p className="text-slate-500 mt-1">
            Auditing CI/CD pipelines for reliability, efficacy, and efficiency.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadWorkflowData}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            Refresh Data
          </button>
          <button
            onClick={runAnalysis}
            disabled={isAnalyzing || !runs.length}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Zap className={cn("w-4 h-4", isAnalyzing && "animate-pulse")} />
            {isAnalyzing ? 'Analyzing...' : 'Run AI Audit'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Manual Audit & Recent Failures */}
        <div className="lg:col-span-1 space-y-6">
          {/* Manual Audit Section */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-indigo-500" />
              Manual Run Audit
            </h2>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Paste a GitHub Actions run URL to audit a specific execution.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/actions/runs/..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <button
                  onClick={() => handleManualAudit((run, result, jobs) => setAnalysis(result))}
                  disabled={isManualLoading || !manualUrl}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {isManualLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Audit'}
                </button>
              </div>

              {manualError && (
                <p className="text-xs text-red-600 font-medium">{manualError}</p>
              )}

              {manualPreview && (
                <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Preview</span>
                    <button onClick={() => setManualPreview(null)} className="text-slate-400 hover:text-slate-600">
                      <AlertCircle className="w-4 h-4 rotate-45" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {manualPreview.run.conclusion === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {manualPreview.run.name}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 space-y-1">
                    <p>Event: {manualPreview.run.event}</p>
                    <p>Jobs: {manualPreview.jobs.length}</p>
                  </div>
                  {loadingStep && (
                    <div className="flex items-center gap-2 text-xs text-indigo-600 font-medium animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      {loadingStep}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Recent Failures List */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Recent Failures</h2>
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full">
                {runs.length} Found
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4 animate-pulse space-y-2">
                    <div className="h-4 bg-slate-100 rounded w-3/4" />
                    <div className="h-3 bg-slate-50 rounded w-1/2" />
                  </div>
                ))
              ) : runs.length > 0 ? (
                runs.map(run => (
                  <div key={run.id} className="p-4 hover:bg-slate-50 transition-colors group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {run.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(run.created_at).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {run.event}
                          </span>
                        </div>
                      </div>
                      <a
                        href={run.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    {/* Failed Jobs Mini-list */}
                    {jobsMap[run.id]?.some(j => j.conclusion === 'failure') && (
                      <div className="mt-3 space-y-1">
                        {jobsMap[run.id]
                          .filter(j => j.conclusion === 'failure')
                          .map(job => (
                            <div key={job.id} className="flex items-center gap-2 text-[10px] font-medium text-red-600 bg-red-50 px-2 py-1 rounded">
                              <Shield className="w-3 h-3" />
                              {job.name}
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 font-medium">No recent failures found.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Analysis Results */}
        <div className="lg:col-span-2 space-y-8">
          {!analysis && !isAnalyzing ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
              <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Zap className="w-10 h-10 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">Ready for Audit</h2>
              <p className="text-slate-500 max-w-md mx-auto mb-8">
                Run an AI-powered audit to analyze your workflow health, identify technical bottlenecks, and get qualitative recommendations.
              </p>
              <button
                onClick={runAnalysis}
                disabled={!runs.length}
                className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
              >
                Start AI Analysis
              </button>
            </div>
          ) : isAnalyzing ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-6">
              <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 border-4 border-indigo-100 rounded-full" />
                <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin" />
                <Zap className="absolute inset-0 m-auto w-10 h-10 text-indigo-600 animate-pulse" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Analyzing Workflows</h2>
                <p className="text-slate-500 mt-2">Gemini is auditing execution patterns and failure logs...</p>
              </div>
              <div className="max-w-xs mx-auto space-y-3">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 animate-[progress_2s_ease-in-out_infinite]" style={{ width: '40%' }} />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <span>Parsing Logs</span>
                  <span>Identifying Patterns</span>
                </div>
              </div>
            </div>
          ) : analysis && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              {/* Health Score & Summary */}
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                <div className="flex flex-col md:flex-row gap-8 items-start">
                  <div className="flex-shrink-0 text-center">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90">
                        <circle
                          cx="64"
                          cy="64"
                          r="58"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          className="text-slate-100"
                        />
                        <circle
                          cx="64"
                          cy="64"
                          r="58"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={364.4}
                          strokeDashoffset={364.4 - (364.4 * analysis.healthScore) / 100}
                          className={cn(
                            "transition-all duration-1000",
                            analysis.healthScore > 80 ? "text-emerald-500" : 
                            analysis.healthScore > 50 ? "text-amber-500" : "text-red-500"
                          )}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-black text-slate-900">{analysis.healthScore}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Health</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-indigo-600" />
                      <h2 className="text-xl font-bold text-slate-900">Executive Summary</h2>
                    </div>
                    <p className="text-slate-600 leading-relaxed italic font-serif text-lg">
                      "{analysis.summary}"
                    </p>
                  </div>
                </div>
              </div>

              {/* Technical Findings */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Technical Findings
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {analysis.technicalFindings.map((finding, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-200 transition-colors group">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                            finding.type === 'failure' ? "bg-red-50 text-red-600" :
                            finding.type === 'warning' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                          )}>
                            {finding.type === 'failure' ? <AlertCircle className="w-5 h-5" /> :
                             finding.type === 'warning' ? <AlertTriangle className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900">{finding.title}</h4>
                            <p className="text-sm text-slate-600 mt-1">{finding.description}</p>
                            {finding.location && (
                              <div className="mt-2 flex items-center gap-2 text-xs font-mono text-slate-400">
                                <FileText className="w-3 h-3" />
                                {finding.location}
                              </div>
                            )}
                            {finding.remediation && (
                              <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Remediation</div>
                                <p className="text-xs text-slate-700 leading-relaxed">{finding.remediation}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => dispatchIssue(
                              finding.title,
                              `[Workflow Audit] ${finding.title}`,
                              `### Description\n${finding.description}\n\n### Location\n\`${finding.location || 'N/A'}\`\n\n### Remediation\n${finding.remediation || 'N/A'}`,
                              ['workflow-audit', finding.type]
                            )}
                            disabled={isDispatching(finding.title)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                            title="Dispatch GitHub Issue"
                          >
                            <Github className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => openWorkerModal(finding)}
                            className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                            title="Send to Remediation Worker"
                          >
                            <Send className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Qualitative Analysis */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <h4 className="font-bold text-slate-900">Efficacy</h4>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{analysis.qualitativeAnalysis.efficacy}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Shield className="w-5 h-5" />
                    <h4 className="font-bold text-slate-900">Coverage</h4>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{analysis.qualitativeAnalysis.coverage}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Zap className="w-5 h-5" />
                    <h4 className="font-bold text-slate-900">Efficiency</h4>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{analysis.qualitativeAnalysis.efficiency}</p>
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-slate-900 rounded-3xl p-8 text-white">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-bold">Strategic Recommendations</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysis.qualitativeAnalysis.recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                      <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400 text-xs font-bold">
                        {idx + 1}
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">{rec}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Worker Selector Modal */}
      <WorkerSelectorModal
        isOpen={workerModal.isOpen}
        onClose={() => setWorkerModal({ isOpen: false, finding: null })}
        julesApiKey={julesApiKey}
        suggestedSessions={suggestedSessions}
        allSessions={allSessions}
        findingId={workerModal.finding?.title || ''}
        description={workerModal.finding?.description || ''}
        julesReportStatus={julesReportStatus}
        onReportToJules={onReportToJules}
      />
    </div>
  );
}
