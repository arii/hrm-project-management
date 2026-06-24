import { useState, useEffect } from 'react';
import { enrichSinglePr } from '../services/githubService';
import { EnrichedPullRequest, GithubPullRequest } from '../types';

export const useEnrichedPr = (repo: string, pr: GithubPullRequest, token: string, includeReviews = false) => {
  const [enriched, setEnriched] = useState<EnrichedPullRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pr) {
      setEnriched(null);
      setLoading(false);
      return;
    }

    const enrich = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await enrichSinglePr(repo, pr, token, includeReviews);
        setEnriched(result);
      } catch (err: any) {
        setError(err.message || 'Failed to enrich PR');
        // Fallback to unenriched on failure to keep the UI functional
        setEnriched(pr as EnrichedPullRequest); 
      } finally {
        setLoading(false);
      }
    };
    enrich();
  }, [repo, pr?.number, pr?.head?.sha, token, includeReviews]);

  return { enriched, loading, error };
};
