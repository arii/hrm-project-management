import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { listSessions, sendMessage, enrichSessionsWithDetails, findSourceForRepo, createSession } from '../services/julesService';
import { storage } from '../services/storageService';
import { JulesSession } from '../types';

export function useJulesSessions(julesApiKey: string | undefined, repo: string) {
  const queryClient = useQueryClient();
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  // Query 1: Find Source
  const { 
    data: sourceId, 
    isLoading: isVerifying, 
    error: verificationError 
  } = useQuery({
    queryKey: ['julesSource', julesApiKey, repo],
    queryFn: () => findSourceForRepo(julesApiKey!, repo, false),
    enabled: !!julesApiKey && !!repo,
  });

  // Query 2: List and Enrich Sessions
  const { 
    data: allSessions = [], 
    isLoading: isListing, 
    isFetching: isEnriching 
  } = useQuery({
    queryKey: ['julesSessions', julesApiKey],
    queryFn: async () => {
      if (!julesApiKey) return [];
      const sessions = await listSessions(julesApiKey);
      const detailed = await enrichSessionsWithDetails(julesApiKey, sessions);
      storage.saveJulesSessions(detailed);
      return detailed;
    },
    enabled: !!julesApiKey,
    initialData: () => storage.getJulesSessions() || [],
  });

  const correlate = useCallback((list: JulesSession[]) => list.filter(s => {
    const repoLower = repo.toLowerCase();
    const matchesText = 
      s.name.toLowerCase().includes(repoLower) || 
      (s.title && s.title.toLowerCase().includes(repoLower));
    
    const matchesContext = 
      s.sourceContext?.githubRepo?.repo?.toLowerCase() === repoLower ||
      s.sourceContext?.githubRepoContext?.repo?.toLowerCase() === repoLower;

    return matchesText || matchesContext;
  }), [repo]);

  const suggestedSessions = correlate(allSessions);

  const onReportToJules = useCallback(async (findingId: string, sessionName: string, message: string) => {
    if (!julesApiKey) return;
    
    const reportKey = `${findingId}-${sessionName}`;
    setJulesReportStatus(prev => ({ ...prev, [reportKey]: 'loading' }));
    
    try {
      await sendMessage(julesApiKey, sessionName, message);
      setJulesReportStatus(prev => ({ ...prev, [reportKey]: 'success' }));
    } catch (error) {
      console.error('Failed to report to Jules:', error);
      setJulesReportStatus(prev => ({ ...prev, [reportKey]: 'error' }));
    }
  }, [julesApiKey]);

  const refetchSessions = useCallback(async (force = false) => {
    if (!julesApiKey) return [];
    const sessions = await listSessions(julesApiKey, force);
    const detailed = await enrichSessionsWithDetails(julesApiKey, sessions);
    storage.saveJulesSessions(detailed);
    queryClient.setQueryData(['julesSessions', julesApiKey], detailed);
    return detailed;
  }, [julesApiKey, queryClient]);

  const createSessionMutation = useMutation({
    mutationFn: async ({ prompt, branch, title }: { prompt: string; branch: string; title: string }) => {
      if (!julesApiKey) throw new Error('Jules API Key required');
      if (!sourceId) throw new Error('Jules Source ID required');
      return createSession(julesApiKey, prompt, sourceId, branch, title);
    },
    onMutate: async ({ branch, title }) => {
      await queryClient.cancelQueries({ queryKey: ['julesSessions', julesApiKey] });

      const previousSessions = queryClient.getQueryData<JulesSession[]>(['julesSessions', julesApiKey]) || [];

      // Create an optimistic JulesSession
      const owner = repo.split('/')[0] || '';
      const repoOnly = repo.split('/')[1] || '';
      const optimisticSession: JulesSession = {
        name: `projects/dummy/locations/global/repositories/dummy/sessions/optimistic-${Date.now()}`,
        state: 'PENDING',
        createTime: new Date().toISOString(),
        title: title,
        sourceContext: {
          githubRepoContext: {
            owner,
            repo: repoOnly,
            startingBranch: branch
          }
        }
      };

      queryClient.setQueryData<JulesSession[]>(['julesSessions', julesApiKey], (old = []) => {
        return [optimisticSession, ...old];
      });

      return { previousSessions };
    },
    onError: (err, variables, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(['julesSessions', julesApiKey], context.previousSessions);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['julesSessions', julesApiKey] });
    }
  });

  return {
    allSessions,
    suggestedSessions,
    isLoading: (!!julesApiKey && isListing) || (!!julesApiKey && !!repo && isVerifying),
    isVerifying: !!julesApiKey && !!repo && isVerifying,
    isEnriching,
    hasVerifiedSource: !!sourceId,
    sourceId,
    verificationError: verificationError ? (verificationError as Error).message : null,
    julesReportStatus,
    onReportToJules,
    refetchSessions,
    createSessionMutation,
    refreshSessions: () => {
      storage.clearRepoSourceId(repo);
      queryClient.invalidateQueries({ queryKey: ['julesSource', julesApiKey, repo] });
      queryClient.invalidateQueries({ queryKey: ['julesSessions', julesApiKey] });
    }
  };
}
