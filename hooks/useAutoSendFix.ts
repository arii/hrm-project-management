import { useEffect, useState } from 'react';
import { listSessions, sendMessage, enrichSessionsWithDetails } from '../services/julesService';
import { enrichSinglePr } from '../services/githubService';
import { storage, StorageKeys } from '../services/storageService';
import { JulesSession } from '../types';

export function useAutoSendFix(julesApiKey: string | undefined, repo: string, onRefresh?: () => void) {
  const getEnabledDefault = () => {
    const val = storage.getItem(StorageKeys.AUTO_SEND_FIX_ENABLED);
    if (val !== null) return val === 'true';
    // Fallback to legacy
    const legacy = storage.getItem('AUTO_SEND_FIX_ENABLED');
    if (legacy !== null) {
      storage.setItem(StorageKeys.AUTO_SEND_FIX_ENABLED, legacy);
      storage.removeItem('AUTO_SEND_FIX_ENABLED');
      return legacy === 'true';
    }
    return false;
  };

  const getLastRunDefault = () => {
    const val = storage.getItem(StorageKeys.AUTO_SEND_FIX_LAST_RUN);
    if (val !== null) return val;
    // Fallback to legacy
    const legacy = storage.getItem('AUTO_SEND_FIX_LAST_RUN');
    if (legacy !== null) {
      storage.setItem(StorageKeys.AUTO_SEND_FIX_LAST_RUN, legacy);
      storage.removeItem('AUTO_SEND_FIX_LAST_RUN');
      return legacy;
    }
    return null;
  };

  const [enabled, setEnabledState] = useState(getEnabledDefault);
  const [lastRun, setLastRun] = useState(getLastRunDefault);
  const [nextRun, setNextRun] = useState<Date | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [autoHealLogs, setAutoHealLogs] = useState<Record<string, string>>(() => {
    return storage.getRaw<Record<string, string>>(StorageKeys.AUTO_HEAL_LOGS, {});
  });

  const setEnabled = (val: boolean) => {
    storage.setItem(StorageKeys.AUTO_SEND_FIX_ENABLED, val ? 'true' : 'false');
    setEnabledState(val);
  };

  const getSentTime = (sessionName: string) => {
    const logs = storage.getRaw<Record<string, string>>(StorageKeys.AUTO_HEAL_LOGS, {});
    if (logs[sessionName]) return logs[sessionName];
    // Fallback to legacy
    const legacy = storage.getItem(`fix-sent-${sessionName}`);
    if (legacy) {
      logs[sessionName] = legacy;
      storage.set(StorageKeys.AUTO_HEAL_LOGS, logs);
      storage.removeItem(`fix-sent-${sessionName}`);
      return legacy;
    }
    return null;
  };

  useEffect(() => {
    if (!julesApiKey) return;

    const isEnabled = storage.getItem(StorageKeys.AUTO_SEND_FIX_ENABLED) === 'true';
    if (!isEnabled) {
      setNextRun(null);
      setIsChecking(false);
      return;
    }

    const poll = async () => {
      setIsChecking(true);
      try {
        const sessions = await listSessions(julesApiKey, true);
        const detailedSessions = await enrichSessionsWithDetails(julesApiKey, sessions);
        const ghToken = storage.getGithubToken();
        
        const targetSessions: JulesSession[] = [];
        
        for (const s of detailedSessions) {
          if (s.state !== 'COMPLETED' && s.state !== 'SUCCEEDED') continue;
          if (getSentTime(s.name)) continue;
          
          // Find PR url in outputs
          const prOutput = s.outputs?.find(o => o.pullRequest?.url && o.pullRequest.url.includes('/pull/'));
          if (!prOutput) {
            // No PR associated with this session, skip auto-healing
            continue;
          }
          
          const prUrl = prOutput.pullRequest!.url;
          const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!match) continue;
          
          const matchedRepo = match[1];
          const prNumber = parseInt(match[2], 10);
          
          if (ghToken) {
            try {
              const prObj = { number: prNumber, head: { sha: '' } } as any;
              const enriched = await enrichSinglePr(matchedRepo, prObj, ghToken, false, true);
              if (enriched.testStatus === 'failed') {
                targetSessions.push(s);
              }
            } catch (e) {
              console.warn(`[AutoSendFix] Failed to fetch CI status for PR #${prNumber} in ${matchedRepo}:`, e);
              // If we fail to fetch, avoid auto-sending to prevent noise/spam
            }
          }
        }
        
        let sentAny = false;
        const newLogs = { ...storage.getRaw<Record<string, string>>(StorageKeys.AUTO_HEAL_LOGS, {}) };
        
        for (const session of targetSessions) {
          await sendMessage(julesApiKey, session.name, "CI errors detected in completed session. Please apply fix.");
          newLogs[session.name] = new Date().toISOString();
          sentAny = true;
        }
        
        if (sentAny) {
          storage.set(StorageKeys.AUTO_HEAL_LOGS, newLogs);
          setAutoHealLogs(newLogs);
        }
        
        const now = new Date();
        storage.setItem(StorageKeys.AUTO_SEND_FIX_LAST_RUN, now.toISOString());
        setLastRun(now.toISOString());
        setNextRun(new Date(now.getTime() + 5 * 60 * 1000));
        
        if (sentAny && onRefresh) {
          onRefresh();
        }
        
      } catch (error) {
        console.error('[AutoSendFix] Polling error:', error);
      } finally {
        setIsChecking(false);
      }
    };

    const interval = setInterval(poll, 5 * 60 * 1000);
    poll();
    
    return () => clearInterval(interval);
  }, [julesApiKey, repo, onRefresh, enabled]);

  return { enabled, setEnabled, lastRun, nextRun, isChecking, autoHealLogs, getSentTime };
}
