
import { useState, useCallback, useEffect } from 'react';
import { AnalysisStatus } from '../types';

export function useGeminiAnalysis<T>(analyzerFn: (...args: any[]) => Promise<T>, persistenceKey?: string) {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [result, setResult] = useState<T | null>(() => {
    if (persistenceKey) {
      try {
        const cached = localStorage.getItem(`audit_analysis_v2_${persistenceKey}`);
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
          localStorage.setItem(`audit_analysis_v2_${persistenceKey}`, JSON.stringify(data));
        } catch (e) {}
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
      localStorage.removeItem(`audit_analysis_v2_${persistenceKey}`);
    }
  }, [persistenceKey]);

  return { status, result, error, run, reset, setResult };
}
