
import React, { useState, useEffect } from 'react';
import { fetchEnrichedPullRequests } from '../services/githubService';
import { analyzePullRequests } from '../services/geminiService';
import { EnrichedPullRequest, AnalysisStatus } from '../types';
import AnalysisCard from '../components/AnalysisCard';
import { GitPullRequest, GitMerge, Clock, User, CheckCircle2, AlertTriangle, FileCode, Check, X, ShieldAlert, FlaskConical, AlertCircle, HelpCircle } from 'lucide-react';
import clsx from 'clsx';

interface PullRequestsProps {
  repoName: string;
  token: string;
}

const PullRequests: React.FC<PullRequestsProps> = ({ repoName, token }) => {
  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  useEffect(() => {
    const loadPrs = async () => {
      setLoading(true);
      try {
        const data = await fetchEnrichedPullRequests(repoName, token);
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

  const getReadyStatusBadge = (pr: EnrichedPullRequest) => {
    // Priority 1: Test Failures block everything
    if (pr.testStatus === 'failed') {
        return (
          <span className="flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider" title="Tests failed. Fix before merging.">
            <AlertTriangle className="w-3 h-3" /> Fix Tests
          </span>
        );
    }

    // Priority 2: Explicit Merge Conflicts
    if (pr.mergeable === false) {
       return (
        <span className="flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
          <X className="w-3 h-3" /> Conflict
        </span>
       );
    }

    // Priority 3: Ready to Merge (Clean + Tests OK or Not Required)
    if (pr.isReadyToMerge) {
      return (
        <span className="flex items-center gap-1 bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
          <CheckCircle2 className="w-3 h-3" /> Ready
        </span>
      );
    }

    // Priority 4: Leader Branch waiting for tests
    if (pr.isLeaderBranch && pr.testStatus !== 'passed') {
        return (
          <span className="flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
            <FlaskConical className="w-3 h-3" /> Testing
          </span>
        );
    }

    return (
       <span className="flex items-center gap-1 bg-slate-700 text-slate-400 border border-slate-600 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
          Review
       </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Pull Request Status Board</h2>
        <p className="text-slate-400">At-a-glance status of merge conflicts, test results, and readiness.</p>
      </div>

      <AnalysisCard 
        title="PR Health Check (AI)"
        description="Identify stale PRs, potential conflicts, and redundant work."
        status={analysisStatus}
        result={analysisResult}
        onAnalyze={handleAnalyze}
        repoName={repoName}
      />

      <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-blue-500" />
            Active PRs
          </h3>
          <span className="bg-slate-700 text-xs px-2 py-1 rounded-full text-white">{prs.length} Open</span>
        </div>
        
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-pulse flex flex-col items-center">
               <div className="h-4 w-48 bg-slate-800 rounded mb-4"></div>
               <p>Fetching PR details & status checks...</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-slate-900/40 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-700">
                   <th className="px-6 py-4">Pull Request</th>
                   <th className="px-6 py-4">Target</th>
                   <th className="px-6 py-4">Merge Status</th>
                   <th className="px-6 py-4">Tests</th>
                   <th className="px-6 py-4">Size</th>
                   <th className="px-6 py-4 text-right">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-700">
                 {prs.map(pr => (
                   <tr key={pr.id} className="hover:bg-slate-800/30 transition-colors group">
                     {/* 1. PR Info */}
                     <td className="px-6 py-4 max-w-md">
                        <div className="flex items-start gap-3">
                           <div className={clsx("mt-1 shrink-0", pr.draft ? "text-slate-500" : "text-green-500")}>
                             {pr.draft ? <FileCode className="w-5 h-5" /> : <GitMerge className="w-5 h-5" />}
                           </div>
                           <div className="min-w-0">
                             <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-white hover:text-primary truncate transition-colors">
                               {pr.title}
                             </a>
                             <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                               <span className="font-mono">#{pr.number}</span>
                               <span className="flex items-center gap-1"><User className="w-3 h-3"/> {pr.user.login}</span>
                             </div>
                           </div>
                        </div>
                     </td>

                     {/* 2. Target Branch */}
                     <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700">
                            {pr.base.ref}
                          </span>
                          {pr.isLeaderBranch && (
                            <span title="Protected Leader Branch">
                              <ShieldAlert className="w-3 h-3 text-amber-500" />
                            </span>
                          )}
                        </div>
                     </td>

                     {/* 3. Merge Status */}
                     <td className="px-6 py-4">
                        {pr.mergeable === true ? (
                          <div className="flex items-center gap-2 text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-xs">No Conflicts</span>
                          </div>
                        ) : pr.mergeable === false ? (
                          <div className="flex items-center gap-2 text-red-400 text-sm">
                             <X className="w-4 h-4" />
                             <span className="text-xs">Conflicts</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-500 text-sm" title="Status unknown or API rate limited">
                             <HelpCircle className="w-4 h-4" />
                             <span className="text-xs">Unknown</span>
                          </div>
                        )}
                     </td>

                     {/* 4. Test Results - Always Show Status */}
                     <td className="px-6 py-4">
                          <div className={clsx(
                             "flex items-center gap-2 text-sm",
                             pr.testStatus === 'passed' ? "text-green-400" :
                             pr.testStatus === 'failed' ? "text-red-400" : "text-slate-400"
                          )}>
                             {pr.testStatus === 'passed' && <Check className="w-4 h-4" />}
                             {pr.testStatus === 'failed' && <AlertCircle className="w-4 h-4" />}
                             {(pr.testStatus === 'pending' || pr.testStatus === 'unknown') && <Clock className="w-4 h-4" />}
                             
                             <span className="text-xs capitalize">
                               {pr.testStatus}
                             </span>
                          </div>
                     </td>

                     {/* 5. Size */}
                     <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={clsx(
                             "text-xs font-bold uppercase",
                             pr.isBig ? "text-purple-400" : "text-slate-400"
                          )}>
                            {pr.isBig ? 'Large' : 'Small'}
                          </span>
                          <span className="text-[10px] text-slate-500">
                             {pr.changed_files} files
                          </span>
                        </div>
                     </td>

                     {/* 6. Action / Status */}
                     <td className="px-6 py-4 text-right">
                        {getReadyStatusBadge(pr)}
                     </td>
                   </tr>
                 ))}
                 {prs.length === 0 && (
                   <tr>
                     <td colSpan={6} className="text-center py-12 text-slate-500">No active pull requests found.</td>
                   </tr>
                 )}
               </tbody>
             </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PullRequests;
