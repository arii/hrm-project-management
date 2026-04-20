import { useState, useEffect, useCallback } from 'react';
import { listSessions, sendMessage } from '../services/julesService';
import { JulesSession } from '../types';

export function useJulesSessions(julesApiKey: string | undefined, repo: string) {
  const [allSessions, setAllSessions] = useState<JulesSession[]>([]);
  const [suggestedSessions, setSuggestedSessions] = useState<JulesSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const loadSessions = useCallback(async () => {
    if (!julesApiKey) return;
    setIsLoading(true);
    try {
      const sessions = await listSessions(julesApiKey);
      setAllSessions(sessions);
      
      // Correlate sessions based on repo name in title or name
      const correlated = sessions.filter(s => {
        const matchesText = 
          s.name.toLowerCase().includes(repo.toLowerCase()) || 
          (s.title && s.title.toLowerCase().includes(repo.toLowerCase()));
        
        return !!matchesText;
      });
      setSuggestedSessions(correlated);
    } catch (error) {
      console.error('Failed to load Jules sessions:', error);
    } finally {
      setIsLoading(false);
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
      
      // Open the session in a new tab
      const sessionId = sessionName.split('/').pop();
      window.open(`https://jules.ai/session/${sessionId}`, '_blank');
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
