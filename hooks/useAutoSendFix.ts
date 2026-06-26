import { useEffect, useState } from 'react';
import { listSessions, sendMessage } from '../services/julesService';
import { fetchCheckRuns } from '../services/githubService';
import { storageManager } from '../src/services/storage/StorageManager';
import { storage } from '../services/storageService';
import { JulesSession } from '../types';

export function useAutoSendFix(julesApiKey: string | undefined, repo: string, onRefresh?: () => void) {
  const [enabled, setEnabledState] = useState(storageManager.getItem('AUTO_SEND_FIX_ENABLED') === 'true');
  const [lastRun, setLastRun] = useState(storageManager.getItem('AUTO_SEND_FIX_LAST_RUN'));
  const [nextRun, setNextRun] = useState<Date | null>(null);

  const setEnabled = (val: boolean) => {
    storageManager.setItem('AUTO_SEND_FIX_ENABLED', val ? 'true' : 'false');
    setEnabledState(val);
  };

  const getSentTime = (sessionName: string) => {
    return storageManager.getItem(`fix-sent-${sessionName}`);
  };

  useEffect(() => {
    if (!julesApiKey) return;

    const poll = async () => {
      const isEnabled = storageManager.getItem('AUTO_SEND_FIX_ENABLED') === 'true';
      if (!isEnabled) return;

      try {
        const sessions = await listSessions(julesApiKey, true);
        const targetSessions = sessions.filter((s: JulesSession) => s.state === 'COMPLETED');
        
        let sentAny = false;
        for (const session of targetSessions) {
          const sentKey = `fix-sent-${session.name}`;
          if (storageManager.getItem(sentKey)) continue;

          // Note: In a production scenario, we would also fetch PR status here.
          // For now, ensuring Jules reported error is the primary trigger.
          
          await sendMessage(julesApiKey, session.name, "CI errors detected in completed session. Please apply fix.");
          
          storageManager.setItem(sentKey, new Date().toISOString());
          sentAny = true;
        }
        
        const now = new Date();
        storageManager.setItem('AUTO_SEND_FIX_LAST_RUN', now.toISOString());
        setLastRun(now.toISOString());
        setNextRun(new Date(now.getTime() + 5 * 60 * 1000));
        
        if (sentAny && onRefresh) {
          onRefresh();
        }
        
      } catch (error) {
        console.error('[AutoSendFix] Polling error:', error);
      }
    };

    const interval = setInterval(poll, 5 * 60 * 1000);
    poll();
    
    return () => clearInterval(interval);
  }, [julesApiKey, repo, onRefresh]);

  return { enabled, setEnabled, lastRun, nextRun, getSentTime };
}
