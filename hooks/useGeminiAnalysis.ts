
import { useState, useCallback } from 'react';
import { AnalysisStatus } from '../types';

export function useGeminiAnalysis<T>(analyzerFn: (...args: any[]) => Promise<T>) {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (...args: any[]) => {
    setStatus(AnalysisStatus.LOADING);
    setError(null);
    try {
      const data = await analyzerFn(...args);
      setResult(data);
      setStatus(AnalysisStatus.COMPLETE);
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
      setStatus(AnalysisStatus.ERROR);
    }
  }, [analyzerFn]);

  const reset = useCallback(() => {
    setStatus(AnalysisStatus.IDLE);
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, run, reset, setResult };
}
