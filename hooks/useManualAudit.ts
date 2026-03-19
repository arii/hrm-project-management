import { useState, useCallback } from 'react';
import { fetchWorkflowRun, fetchWorkflowRunJobs, fetchJobAnnotations, fetchWorkflowFileAtSha } from '../services/githubService';
import { analyzeWorkflowHealth } from '../services/geminiService';
import { GithubWorkflowRun, GithubWorkflowJob, GithubAnnotation, WorkflowAnalysis } from '../types';

interface ManualPreview {
  run: GithubWorkflowRun;
  jobs: GithubWorkflowJob[];
  annotations: Record<number, GithubAnnotation[]>;
  repo: string;
}

export function useManualAudit(token: string) {
  const [manualUrl, setManualUrl] = useState('');
  const [manualPreview, setManualPreview] = useState<ManualPreview | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const handleManualAudit = useCallback(async (onSuccess: (run: GithubWorkflowRun, result: WorkflowAnalysis, jobs: GithubWorkflowJob[]) => void) => {
    if (!manualUrl.trim() || !token) return;
    setManualError(null);
    setManualPreview(null);
    
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

      setManualPreview({ run, jobs, annotations, repo: targetRepo });
      setLoadingStep('Fetching workflow definition at commit SHA...');
      
      const workflowYaml = await fetchWorkflowFileAtSha(targetRepo, run, token).catch(() => null);
      setLoadingStep('Context loaded. AI Auditor initiating deep reasoning scan...');
      
      const result = await analyzeWorkflowHealth(run, jobs, annotations, workflowYaml);
      
      onSuccess(run, result, jobs);
      setManualUrl('');
      setTimeout(() => setManualPreview(null), 500);
    } catch (e: any) {
      console.error('[ManualAudit] Error:', e);
      setManualError(`Link Failed: ${e.message}. Ensure the token has 'actions' read access.`);
    } finally {
      setIsManualLoading(false);
      setLoadingStep('');
    }
  }, [manualUrl, token]);

  return { manualUrl, setManualUrl, manualPreview, setManualPreview, manualError, setManualError, isManualLoading, loadingStep, handleManualAudit };
}
