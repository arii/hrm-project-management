import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { fetchPullRequests, enrichSinglePr, updatePullRequestBranch } from '../services/githubService';
import { EnrichedPullRequest } from '../types';

// Track active enrichment loops per repository key to prevent duplicates across components
interface ActiveEnrichment {
  abortController: AbortController;
}
const activeEnrichments = new Map<string, ActiveEnrichment>();

export interface ProgressState {
  total: number;
  current: number;
  status: string;
}

export function usePullRequests(repoName: string, token: string) {
  const queryClient = useQueryClient();
  const repoKey = `${repoName}::${token}`;

  const queryKey = ['pullRequests', repoName];
  const progressKey = ['pullRequests', repoName, 'progress'];

  // 1. Fetch BASIC PR list immediately using useQuery
  const { data: prs = [], isLoading, isError, error, refetch: originalRefetch, isFetching } = useQuery<EnrichedPullRequest[], Error>({
    queryKey,
    queryFn: async () => {
      if (!repoName || !token) return [];
      const list = await fetchPullRequests(repoName, token, 'open', false);
      return list.map(pr => ({
        ...pr,
        testStatus: 'unknown',
        isApproved: false,
        isBig: false,
        isReadyToMerge: false,
        isLeaderBranch: false
      } as EnrichedPullRequest));
    },
    enabled: !!repoName && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes cache TTL
  });

  // 2. Reactive progress subscription
  const { data: progress = { total: 0, current: 0, status: '' } } = useQuery<ProgressState>({
    queryKey: progressKey,
    queryFn: () => {
      return queryClient.getQueryData<ProgressState>(progressKey) || { total: 0, current: 0, status: '' };
    },
    enabled: !!repoName,
    staleTime: Infinity,
    initialData: { total: 0, current: 0, status: '' }
  });

  // 3. Custom unified refetch with optional skipCache flag
  const refetch = useCallback(async (options?: { skipCache?: boolean }) => {
    const skipCache = options?.skipCache ?? false;
    
    // Abort any ongoing enrichment for this repository
    const active = activeEnrichments.get(repoKey);
    if (active) {
      active.abortController.abort();
      activeEnrichments.delete(repoKey);
    }

    queryClient.setQueryData(progressKey, { total: 0, current: 0, status: 'Refreshing...' });

    if (skipCache) {
      // Bypass cache to load fresh basic PRs and update cache immediately
      const list = await fetchPullRequests(repoName, token, 'open', true);
      const initialPrs = list.map(pr => ({
        ...pr,
        testStatus: 'unknown',
        isApproved: false,
        isBig: false,
        isReadyToMerge: false,
        isLeaderBranch: false
      } as EnrichedPullRequest));
      queryClient.setQueryData(queryKey, initialPrs);
      return { data: initialPrs };
    } else {
      return await originalRefetch();
    }
  }, [repoName, token, queryClient, originalRefetch, repoKey, queryKey, progressKey]);

  // 4. Background Enrichment Loop running as an effect
  useEffect(() => {
    if (!repoName || !token || prs.length === 0) return;

    // Prevent duplicate parallel enrichment loops
    if (activeEnrichments.has(repoKey)) {
      return;
    }

    // Only run enrichment if we have PRs in "unknown" status
    const needsEnrichment = prs.some(pr => pr.testStatus === 'unknown');
    if (!needsEnrichment) {
      return;
    }

    const abortController = new AbortController();
    activeEnrichments.set(repoKey, { abortController });

    const runEnrichment = async () => {
      const signal = abortController.signal;
      const toEnrich = prs.slice(0, 30); // Max 30 to enrich
      const total = toEnrich.length;
      let current = 0;

      queryClient.setQueryData(progressKey, { total, current, status: 'Initializing enrichment...' });

      const chunkSize = 3;
      for (let i = 0; i < total; i += chunkSize) {
        if (signal.aborted) break;

        const chunk = toEnrich.slice(i, i + chunkSize);
        
        queryClient.setQueryData(progressKey, { 
          total, 
          current, 
          status: `Analyzing PRs ${i + 1}-${Math.min(i + chunkSize, total)} of ${total}...` 
        });

        try {
          const enrichedResults = await Promise.all(chunk.map(async (pr) => {
            if (signal.aborted) return pr;
            try {
              return await enrichSinglePr(repoName, pr, token, false);
            } catch (e) {
              console.warn(`[usePullRequests] Failed to enrich PR #${pr.number}`, e);
              return pr;
            } finally {
              current++;
            }
          }));

          if (signal.aborted) break;

          // Safely update the React Query cache with the enriched objects
          queryClient.setQueryData<EnrichedPullRequest[]>(queryKey, (prev = []) => {
            return prev.map(p => {
              const matching = enrichedResults.find(er => er.number === p.number);
              return matching ? matching : p;
            });
          });

          queryClient.setQueryData(progressKey, { total, current, status: 'Enrichment in progress...' });
        } catch (err) {
          console.error('[usePullRequests] Chunk enrichment error:', err);
        }
      }

      if (!signal.aborted) {
        queryClient.setQueryData(progressKey, { total: 0, current: 0, status: '' });
        activeEnrichments.delete(repoKey);
      }
    };

    runEnrichment();

    return () => {
      // Do not abort on unmount of a single component because other pages might be active.
      // The AbortController will be cleaned up on manual refetches or if the active loop finishes.
    };
  }, [repoName, token, prs, queryClient, repoKey, queryKey, progressKey]);

  const updateBranchMutation = useMutation({
    mutationFn: async ({ prNumber }: { prNumber: number }) => {
      if (!token) throw new Error('Token required');
      return updatePullRequestBranch(repoName, prNumber, token);
    },
    onMutate: async ({ prNumber }) => {
      await queryClient.cancelQueries({ queryKey });

      const previousPrs = queryClient.getQueryData<EnrichedPullRequest[]>(queryKey) || [];

      queryClient.setQueryData<EnrichedPullRequest[]>(queryKey, (old = []) => {
        return old.map(pr => {
          if (pr.number === prNumber) {
            return {
              ...pr,
              mergeable_state: 'clean',
            };
          }
          return pr;
        });
      });

      return { previousPrs };
    },
    onError: (err, variables, context) => {
      if (context?.previousPrs) {
        queryClient.setQueryData(queryKey, context.previousPrs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  return {
    prs,
    isLoading,
    isError,
    error: error ? error.message : null,
    isFetching,
    refetch,
    listProgress: progress,
    batchStatus: progress.status,
    updateBranchMutation
  };
}
