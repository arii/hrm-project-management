import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createIssue } from '../services/githubService';

export function useIssueDispatch(repoName: string, token: string) {
  const [dispatchStatus, setDispatchStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [dispatchErrors, setDispatchErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async ({ id, title, body, labels = [] }: { id: string, title: string, body: string, labels?: string[] }) => {
      if (!token) throw new Error('Token required');
      return createIssue(repoName, token, {
        title,
        body: `${body}\n\n---\n*Auto-generated via RepoAuditor.*`,
        labels: [...labels, 'automated-dispatch']
      });
    },
  });

  const dispatchIssue = useCallback(async (id: string, title: string, body: string, labels: string[] = []) => {
    setDispatchStatus(prev => ({ ...prev, [id]: 'loading' }));
    setDispatchErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      await mutation.mutateAsync({ id, title, body, labels });
      setDispatchStatus(prev => ({ ...prev, [id]: 'success' }));
      return true;
    } catch (e: any) {
      console.error(`Dispatch failed: ${e.message}`);
      setDispatchStatus(prev => ({ ...prev, [id]: 'error' }));
      setDispatchErrors(prev => ({ ...prev, [id]: e.message }));
      return false;
    }
  }, [mutation]);

  return { 
    dispatchStatus, 
    dispatchErrors,
    dispatchIssue, 
    isDispatching: (id: string) => dispatchStatus[id] === 'loading',
    isSuccess: (id: string) => dispatchStatus[id] === 'success',
    setDispatchStatus 
  };
}
