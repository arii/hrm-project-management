
import { useState, useCallback, useEffect } from 'react';
import { AnalysisStatus } from '../types';
import { storage, StorageKeys } from '../services/storageService';

export function useGeminiAnalysis<T>(analyzerFn: (...args: any[]) => Promise<T>, persistenceKey?: string) {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [result, setResult] = useState<T | null>(() => {
    if (persistenceKey) {
      const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
      const cached = storage.getRaw<T | null>(fullKey, null);
      if (cached) {
        // If we have a cached result, we start as COMPLETE
        return cached;
      }
    }
    return null;
  });

  // If we have an initial result, ensure status is COMPLETE
  if (result && status === AnalysisStatus.IDLE) {
    setStatus(AnalysisStatus.COMPLETE);
  }

  const run = useCallback(async (...args: any[]) => {
    setStatus(AnalysisStatus.LOADING);
    setError(null);
    try {
      const data = await analyzerFn(...args);
      setResult(data);
      setStatus(AnalysisStatus.COMPLETE);
      
      if (persistenceKey) {
        const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
        const success = storage.set(fullKey, data);
        if (!success) {
          console.warn('[useGeminiAnalysis] Persistence failed (likely quota). Analysis succeeded but result will not be cached.');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
      setStatus(AnalysisStatus.ERROR);
    }
  }, [analyzerFn, persistenceKey]);

  const reset = useCallback(() => {
    setStatus(AnalysisStatus.IDLE);
    setResult(null);
    setError(null);
    if (persistenceKey) {
      const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
      storage.remove(fullKey);
    }
  }, [persistenceKey]);

  return { status, result, error, run, reset, setResult };
}
