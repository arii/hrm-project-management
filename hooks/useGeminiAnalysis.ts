
import { useState, useCallback, useEffect } from 'react';
import { AnalysisStatus } from '../types';
import { StorageKeys } from '../services/storageService';

export function useGeminiAnalysis<T>(analyzerFn: (...args: any[]) => Promise<T>, persistenceKey?: string) {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [result, setResult] = useState<T | null>(() => {
    if (persistenceKey) {
      try {
        const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
        const cached = localStorage.getItem(fullKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (e) {
        console.warn('Failed to parse cached analysis', e);
      }
    }
    return null;
  });

  useEffect(() => {
    if (result && status === AnalysisStatus.IDLE) {
      setStatus(AnalysisStatus.COMPLETE);
    }
  }, []);

  const run = useCallback(async (...args: any[]) => {
    setStatus(AnalysisStatus.LOADING);
    setError(null);
    try {
      const data = await analyzerFn(...args);
      setResult(data);
      setStatus(AnalysisStatus.COMPLETE);
      
      if (persistenceKey) {
        try {
          const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
          localStorage.setItem(fullKey, JSON.stringify(data));
        } catch (e) {
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
      localStorage.removeItem(fullKey);
    }
  }, [persistenceKey]);

  return { status, result, error, run, reset, setResult };
}
