
import { useMutation } from '@tanstack/react-query';
import { AnalysisStatus } from '../types';
import { storage, StorageKeys } from '../services/storageService';

export function useGeminiAnalysis<T, A extends any[]>(analyzerFn: (...args: A) => Promise<T>, persistenceKey?: string) {
  const mutation = useMutation({
    mutationFn: async (args: A) => {
      const data = await analyzerFn(...args);
      
      if (persistenceKey) {
        const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
        const success = storage.set(fullKey, data);
        if (!success) {
          console.warn('[useGeminiAnalysis] Persistence failed (likely quota). Analysis succeeded but result will not be cached.');
        }
      }
      return data;
    },
  });

  const run = async (...args: A) => {
    return mutation.mutateAsync(args);
  };

  const reset = () => {
    mutation.reset();
    if (persistenceKey) {
      const fullKey = `${StorageKeys.ANALYSIS_PREFIX}${persistenceKey}`;
      storage.remove(fullKey);
    }
  };

  const status = mutation.isPending 
    ? AnalysisStatus.LOADING 
    : mutation.isError 
      ? AnalysisStatus.ERROR 
      : mutation.isSuccess 
        ? AnalysisStatus.COMPLETE 
        : AnalysisStatus.IDLE;

  return { 
    status, 
    result: mutation.data || null, 
    error: mutation.error ? (mutation.error as Error).message : null, 
    run, 
    reset,
    setResult: (data: T | null) => {} // Simplified/Removed, as mutation result is driven by run
  };
}
