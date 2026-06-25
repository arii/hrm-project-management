import { useQuery } from '@tanstack/react-query';
import { enrichSinglePr } from '../services/githubService';
import { EnrichedPullRequest, GithubPullRequest } from '../types';

export const useEnrichedPr = (repo: string, pr: GithubPullRequest, token: string, includeReviews = false) => {
  const query = useQuery({
    queryKey: ['enrichedPr', repo, pr?.number, pr?.head?.sha, includeReviews],
    queryFn: async () => {
      if (!pr) return null;
      try {
        return await enrichSinglePr(repo, pr, token, includeReviews);
      } catch (err: any) {
        // Fallback to unenriched on failure to keep the UI functional
        return pr as EnrichedPullRequest;
      }
    },
    enabled: !!pr && !!token,
  });

  return { 
    enriched: query.data || null, 
    loading: query.isLoading, 
    error: query.error ? (query.error as Error).message : null 
  };
};
