import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { listSessions, sendMessage, enrichSessionsWithDetails, findSourceForRepo } from '../services/julesService';
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

  return {
    allSessions,
    suggestedSessions,
    isLoading: isListing || isVerifying,
    isVerifying,
    isEnriching,
    hasVerifiedSource: !!sourceId,
    sourceId,
    verificationError: verificationError ? (verificationError as Error).message : null,
    julesReportStatus,
    onReportToJules,
    refreshSessions: () => {
      storage.clearRepoSourceId(repo);
      queryClient.invalidateQueries({ queryKey: ['julesSource', julesApiKey, repo] });
      queryClient.invalidateQueries({ queryKey: ['julesSessions', julesApiKey, sourceId] });
    }
  };
}
