
import { useState, useCallback, useEffect } from 'react';
import { AnalysisStatus } from '../types';

export function useGeminiAnalysis<T>(analyzerFn: (...args: any[]) => Promise<T>, persistenceKey?: string) {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize result from storage if persistenceKey is provided
  const [result, setResult] = useState<T | null>(() => {
    if (persistenceKey) {
      try {
        const cached = sessionStorage.getItem(`analysis_v1_${persistenceKey}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (e) {
        console.warn('Failed to parse cached analysis', e);
      }
    }
    return null;
  });

  // If we loaded a cached result, set status to COMPLETE on mount
  useEffect(() => {
    if (result && status === AnalysisStatus.IDLE) {
      setStatus(AnalysisStatus.COMPLETE);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (...args: any[]) => {
    setStatus(AnalysisStatus.LOADING);
    setError(null);
    try {
      const data = await analyzerFn(...args);
      setResult(data);
      setStatus(AnalysisStatus.COMPLETE);
      
      if (persistenceKey) {
        try {
          sessionStorage.setItem(`analysis_v1_${persistenceKey}`, JSON.stringify(data));
        } catch (e) {
          console.warn('Failed to cache analysis result', e);
        }
      }
    } catch (e: any) {
      let msg = e.message || 'Analysis failed';
      // Enhance error message for known API quotas
      if (msg.includes('exhausted') || msg.includes('429')) {
        msg = "AI Quota Exceeded. Please try again later or check your API usage limits.";
      }
      setError(msg);
      setStatus(AnalysisStatus.ERROR);
    }
  }, [analyzerFn, persistenceKey]);

  const reset = useCallback(() => {
    setStatus(AnalysisStatus.IDLE);
    setResult(null);
    setError(null);
    if (persistenceKey) {
      sessionStorage.removeItem(`analysis_v1_${persistenceKey}`);
    }
  }, [persistenceKey]);

  return { status, result, error, run, reset, setResult };
}
