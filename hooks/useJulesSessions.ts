import { useState, useEffect, useCallback, useRef } from 'react';
import { listSessions, sendMessage, enrichSessionsWithDetails, getSessionUrl, findSourceForRepo } from '../services/julesService';
import { storage } from '../services/storageService';
import { JulesSession } from '../types';

export function useJulesSessions(julesApiKey: string | undefined, repo: string) {
  const [allSessions, setAllSessions] = useState<JulesSession[]>([]);
  const [suggestedSessions, setSuggestedSessions] = useState<JulesSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [julesReportStatus, setJulesReportStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const performVerification = useCallback(async () => {
    if (!julesApiKey || !repo) return null;
    setIsVerifying(true);
    setVerificationError(null);
    try {
      // Pass allowGuess=false to verify if a REAL source exists for this repo
      const verifiedId = await findSourceForRepo(julesApiKey, repo, false);
      if (!verifiedId) {
        setVerificationError('No matching Jules source found for this repository.');
      }
      setSourceId(verifiedId);
      return verifiedId;
    } catch (e: any) {
      console.warn('[JulesSessions] Source verification failed:', e);
      setVerificationError(e.message || 'Verification failed');
      return null;
    } finally {
      setIsVerifying(false);
    }
  }, [julesApiKey, repo]);

  const loadSessions = useCallback(async (verifiedId?: string | null) => {
    if (!julesApiKey) return;
    
    // If no verified ID was passed, and we don't have one in state, verify first
    const activeId = verifiedId !== undefined ? verifiedId : sourceId;
    if (!activeId) {
      // console.log('[JulesSessions] Holding off on session load - awaiting verified sourceId');
      return;
    }
    
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
    } catch (error: any) {
      // Silent common errors that clutter console
      if (!error.message?.includes('404') && !error.message?.includes('Forbidden')) {
        console.error('Failed to load Jules sessions:', error);
      }
    } finally {
      setIsLoading(false);
      setIsEnriching(false);
    }
  }, [julesApiKey, repo, sourceId]);

  const hasInitialized = useRef<string | false>(false);

  useEffect(() => {
    let mounted = true;
    
    // Only run init once per repo/key combo
    const currentCombo = `${julesApiKey}:${repo}`;
    if (hasInitialized.current === currentCombo) return;
    hasInitialized.current = currentCombo as any;

    async function init() {
      if (!julesApiKey || !repo) return;
      const vId = await performVerification();
      if (mounted && vId) {
        loadSessions(vId);
      }
    }

    init();
    return () => { mounted = false; };
  }, [julesApiKey, repo]);

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
    isVerifying,
    isEnriching,
    hasVerifiedSource: !!sourceId,
    sourceId,
    verificationError,
    julesReportStatus,
    onReportToJules,
    refreshSessions: () => performVerification().then(v => {
      if (v) loadSessions(v);
    })
  };
}
