import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  const [loadingStep, setLoadingStep] = useState('');

  const mutation = useMutation({
    mutationFn: async ({ urlToUse, onSuccess }: { urlToUse: string, onSuccess: (run: GithubWorkflowRun, result: WorkflowAnalysis, jobs: GithubWorkflowJob[]) => void }) => {
      if (!urlToUse.trim() || !token) throw new Error('Missing URL or token');
      
      const match = urlToUse.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
      if (!match) throw new Error("Invalid URL format. Expected: github.com/owner/repo/actions/runs/ID");

      const targetRepo = match[1];
      const runId = parseInt(match[2], 10);

      setLoadingStep('Establishing link with GitHub API...');
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
      return { run, result, jobs };
    },
  });

  const handleManualAudit = async (onSuccess: (run: GithubWorkflowRun, result: WorkflowAnalysis, jobs: GithubWorkflowJob[]) => void, overrideUrl?: string) => {
    const urlToUse = overrideUrl || manualUrl;
    try {
      await mutation.mutateAsync({ urlToUse, onSuccess });
    } catch (e: any) {
      console.error('[ManualAudit] Error:', e);
      throw e; // Let the component handle the error via mutation.error
    }
  };

  return { 
    manualUrl, 
    setManualUrl, 
    manualPreview, 
    setManualPreview, 
    manualError: mutation.error ? (mutation.error as Error).message : null, 
    isManualLoading: mutation.isPending, 
    loadingStep, 
    handleManualAudit 
  };
}
