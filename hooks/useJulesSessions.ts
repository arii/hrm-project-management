import { useState, useEffect, useCallback } from 'react';
import { listSessions, sendMessage, enrichSessionsWithDetails, getSessionUrl } from '../services/julesService';
import { storage } from '../services/storageService';
import { JulesSession } from '../types';

export function useJulesSessions(julesApiKey: string | undefined, repo: string) {
  const [allSessions, setAllSessions] = useState<JulesSession[]>([]);
  const [suggestedSessions, setSuggestedSessions] = useState<JulesSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const loadSessions = useCallback(async () => {
    if (!julesApiKey) return;
    
    // Check cache first
    const cached = storage.getJulesSessions();
    if (cached) {
      setAllSessions(cached);
      const correlate = (list: JulesSession[]) => list.filter(s => {
        const repoLower = repo.toLowerCase();
        const matchesText = 
          s.name.toLowerCase().includes(repoLower) || 
          (s.title && s.title.toLowerCase().includes(repoLower));
        
        const matchesContext = 
          s.sourceContext?.githubRepo?.repo?.toLowerCase() === repoLower ||
          s.sourceContext?.githubRepoContext?.repo?.toLowerCase() === repoLower;

        return matchesText || matchesContext;
      });
      setSuggestedSessions(correlate(cached));
    }

    setIsLoading(true);
    try {
      const sessions = await listSessions(julesApiKey);
      setAllSessions(sessions);
      
      const correlate = (list: JulesSession[]) => list.filter(s => {
        const repoLower = repo.toLowerCase();
        const matchesText = 
          s.name.toLowerCase().includes(repoLower) || 
          (s.title && s.title.toLowerCase().includes(repoLower));
        
        const matchesContext = 
          s.sourceContext?.githubRepo?.repo?.toLowerCase() === repoLower ||
          s.sourceContext?.githubRepoContext?.repo?.toLowerCase() === repoLower;

        return matchesText || matchesContext;
      });
      
      setSuggestedSessions(correlate(sessions));
      
      // Start background enrichment
      setIsEnriching(true);
      const detailed = await enrichSessionsWithDetails(julesApiKey, sessions);
      setAllSessions(detailed);
      setSuggestedSessions(correlate(detailed));
      
      // Update cache with enriched data
      storage.saveJulesSessions(detailed);
    } catch (error) {
      console.error('Failed to load Jules sessions:', error);
    } finally {
      setIsLoading(false);
      setIsEnriching(false);
    }
  }, [julesApiKey, repo]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
    isLoading,
    julesReportStatus,
    onReportToJules,
    refreshSessions: loadSessions
  };
}
