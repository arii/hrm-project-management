import { useState, useCallback } from 'react';
import { createIssue } from '../services/githubService';

export function useIssueDispatch(repoName: string, token: string) {
  const [dispatchStatus, setDispatchStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [dispatchErrors, setDispatchErrors] = useState<Record<string, string>>({});

  const dispatchIssue = useCallback(async (id: string, title: string, body: string, labels: string[] = []) => {
    if (!token) return false;
    setDispatchStatus(prev => ({ ...prev, [id]: 'loading' }));
    setDispatchErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      await createIssue(repoName, token, {
        title,
        body: `${body}\n\n---\n*Auto-generated via RepoAuditor.*`,
        labels: [...labels, 'automated-dispatch']
      });
      setDispatchStatus(prev => ({ ...prev, [id]: 'success' }));
      return true;
    } catch (e: any) {
      console.error(`Dispatch failed: ${e.message}`);
      setDispatchStatus(prev => ({ ...prev, [id]: 'error' }));
      setDispatchErrors(prev => ({ ...prev, [id]: e.message }));
      return false;
    }
  }, [repoName, token]);

  return { 
    dispatchStatus, 
    dispatchErrors,
    dispatchIssue, 
    isDispatching: (id: string) => dispatchStatus[id] === 'loading',
    isSuccess: (id: string) => dispatchStatus[id] === 'success',
    setDispatchStatus 
  };
}
