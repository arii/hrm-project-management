
import React, { useState, useEffect } from 'react';
import { fetchPullRequests } from '../services/githubService';
import { analyzePullRequests } from '../services/geminiService';
import { GithubPullRequest, AnalysisStatus } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { GitPullRequest, GitMerge, Clock, User, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

interface PullRequestsProps {
  repoName: string;
  token: string;
}

const PullRequests: React.FC<PullRequestsProps> = ({ repoName, token }) => {
  const [prs, setPrs] = useState<GithubPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  useEffect(() => {
    const loadPrs = async () => {
      setLoading(true);
      try {
        const data = await fetchPullRequests(repoName, token, 'open');
        setPrs(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadPrs();
    setAnalysisResult(null);
    setAnalysisStatus(AnalysisStatus.IDLE);
  }, [repoName, token]);

  const handleAnalyze = async () => {
    setAnalysisStatus(AnalysisStatus.LOADING);
    try {
      const result = await analyzePullRequests(prs);
      setAnalysisResult(result);
      setAnalysisStatus(AnalysisStatus.COMPLETE);
    } catch (e) {
      setAnalysisStatus(AnalysisStatus.ERROR);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Pull Request Audit</h2>
        <p className="text-slate-400">Evaluate mergeability, redundancy, and staleness of open PRs.</p>
      </div>

      <AnalysisCard 
        title="PR Health Check"
        description="Identify stale PRs, potential conflicts, and redundant work."
        status={analysisStatus}
        result={analysisResult}
        onAnalyze={handleAnalyze}
        repoName={repoName}
      />

      <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="font-semibold text-white">Active Pull Requests</h3>
          <span className="bg-slate-700 text-xs px-2 py-1 rounded-full text-white">{prs.length} Open</span>
        </div>
        
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading PRs...</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {prs.map(pr => (
              <div key={pr.id} className="p-4 hover:bg-slate-800/30 transition-colors">
                <div className="flex items-start gap-4">
                  <div className={clsx("mt-1", pr.draft ? "text-slate-500" : "text-green-500")}>
                    {pr.draft ? <GitPullRequest className="w-5 h-5" /> : <GitMerge className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                       <h4 className="text-base font-medium text-slate-200 truncate pr-4">
                         <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                           {pr.title}
                         </a>
                       </h4>
                       <span className="text-sm font-mono text-slate-500">#{pr.number}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-400">
                       <span className="flex items-center gap-1">
                         <User className="w-3 h-3" /> {pr.user.login}
                       </span>
                       <span className="flex items-center gap-1">
                         <Clock className="w-3 h-3" /> {new Date(pr.created_at).toLocaleDateString()}
                       </span>
                       <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
                         {pr.base.ref} ← {pr.head.ref}
                       </span>
                       {pr.draft && <span className="text-amber-500 font-bold border border-amber-500/20 px-1 rounded bg-amber-500/10">DRAFT</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {prs.length === 0 && <div className="p-8 text-center text-slate-500">No open pull requests found.</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default PullRequests;