
import React, { useEffect, useState } from 'react';
import { fetchRepoStats, fetchIssues, fetchPullRequests } from '../services/githubService';
import { generateRepoBriefing } from '../services/geminiService';
import { RepoStats, GithubIssue, GithubPullRequest } from '../types';
import { Activity, AlertCircle, GitPullRequest, Zap, CheckCircle2, Play, CheckCircle, ArrowRight, Eye, Trash2, Settings, GitMerge } from 'lucide-react';
import { getRecommendedWorkflow } from '../services/telemetryService';
import AnalysisCard from '../components/AnalysisCard';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';
import Button from '../components/ui/Button';
import { Link } from 'react-router-dom';
import { useMaintenance } from '../contexts/MaintenanceContext';

interface DashboardProps {
  repoName: string;
  token: string;
}

const Dashboard: React.FC<DashboardProps> = ({ repoName, token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Data State
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [openIssues, setOpenIssues] = useState<GithubIssue[]>([]);
  const [openPrs, setOpenPrs] = useState<GithubPullRequest[]>([]);
  
  // Daily Maintenance Context
  const { results: maintenanceResults, isRunning: maintenanceRunning, step: maintenanceStep, runMaintenance, clearResults } = useMaintenance();

  // AI Insight Hook (Cached)
  const briefingAnalysis = useGeminiAnalysis(generateRepoBriefing, 'dashboard_briefing');

  useEffect(() => {
    if (token) {
       loadData();
    } else {
       setLoading(false);
    }
  }, [repoName, token]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [repoData, prsData, issuesData] = await Promise.all([
        fetchRepoStats(repoName, token),
        fetchPullRequests(repoName, token, 'open'),
        fetchIssues(repoName, token, 'open'),
      ]);
      
      repoData.openPRsCount = prsData.length;
      repoData.openIssuesCount = issuesData.length;
      setStats(repoData);
      setOpenPrs(prsData);
      setOpenIssues(issuesData);

    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBriefing = async () => {
    if (!stats) return;
    await briefingAnalysis.run(
      stats, 
      { opened: 0, closed: 0 }, // Simplified velocity for briefing
      openIssues.slice(0, 10),
      openPrs.slice(0, 5)
    );
  };

  const handleRunMaintenance = () => {
    runMaintenance();
  };

  const recommendedTools = getRecommendedWorkflow();

  const getToolIcon = (path: string) => {
    if (path.includes('code-review')) return Eye;
    if (path.includes('cleanup')) return CheckCircle;
    if (path.includes('issues')) return AlertCircle;
    return Activity;
  };

  const getToolLabel = (path: string) => {
    if (path.includes('code-review')) return 'Code Review';
    if (path.includes('cleanup')) return 'Cleanup Report';
    if (path.includes('issues')) return 'Issue Analysis';
    return path.replace('/', '');
  };

  // EMPTY STATE: No Token
  if (!token) {
     return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
           <div className="bg-slate-800 p-6 rounded-full mb-6 shadow-xl shadow-blue-500/10">
              <GitMerge className="w-16 h-16 text-blue-500" />
           </div>
           <h2 className="text-3xl font-bold text-white mb-3">Welcome to RepoAuditor</h2>
           <p className="text-slate-400 max-w-md mb-8 text-lg">
             Connect your GitHub repository to generate AI-powered insights, clean up technical debt, and automate triage.
           </p>
           <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 flex items-center gap-3">
              <Settings className="w-5 h-5 animate-spin-slow" />
              <span>Click the <strong>Settings</strong> icon in the top right to configure your GitHub Token.</span>
           </div>
        </div>
     );
  }

  if (loading) return <div className="flex justify-center items-center h-96"><Activity className="w-8 h-8 animate-spin text-primary" /></div>;
  if (error) return <div className="text-red-400 p-4 border border-red-800 rounded-lg bg-red-900/20">Error: {error}. Check your settings.</div>;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      
      {/* 1. Daily Maintenance Hero Section */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-8 relative overflow-hidden">
         <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Zap className="w-64 h-64 text-blue-500" />
         </div>
         
         <div className="relative z-10">
            <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
              <Zap className="w-8 h-8 text-yellow-400" /> 
              Daily Maintenance
            </h2>
            <p className="text-slate-400 max-w-2xl mb-6 text-lg">
              Automate your workflow. Run Issue Analysis, PR Health Checks, and Cleanup Reports in a single batch to keep {repoName} healthy.
            </p>

            {!maintenanceResults && (
              <Button 
                size="lg" 
                onClick={handleRunMaintenance} 
                isLoading={maintenanceRunning} 
                disabled={maintenanceRunning}
                icon={Play}
                className="text-lg px-8 py-4 shadow-xl shadow-blue-500/20"
              >
                {maintenanceRunning ? maintenanceStep : "Run Full Audit"}
              </Button>
            )}

            {/* Combined Results View */}
            {maintenanceResults && (
              <div className="animate-in fade-in slide-in-from-bottom-4 space-y-4">
                 <div className="flex items-center gap-2 text-green-400 mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                    <span className="font-bold">Audit Complete</span>
                    {maintenanceResults.timestamp && (
                      <span className="text-xs text-slate-500 ml-2 font-mono">
                        Run {new Date(maintenanceResults.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={clearResults} className="ml-4">Reset</Button>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Issue Result */}
                    <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl">
                       <h4 className="text-blue-300 font-bold mb-2 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Backlog</h4>
                       <div className="text-sm text-slate-300 mb-4">
                          {maintenanceResults.issues?.redundantIssues?.length || 0} duplicates found.
                          {maintenanceResults.issues?.consolidatedIssues?.length || 0} consolidation opportunities.
                       </div>
                       <Link to="/issues" className="text-xs bg-blue-500/10 text-blue-400 px-3 py-2 rounded-lg hover:bg-blue-500/20 flex items-center justify-between group">
                          View Actions <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                       </Link>
                    </div>

                    {/* PR Result */}
                    <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl">
                       <h4 className="text-purple-300 font-bold mb-2 flex items-center gap-2"><GitPullRequest className="w-4 h-4"/> PR Health</h4>
                       <div className="text-sm text-slate-300 mb-4">
                          {maintenanceResults.prs?.actions?.length || 0} recommended actions found for {openPrs.length} PRs.
                       </div>
                       <Link to="/pull-requests" className="text-xs bg-purple-500/10 text-purple-400 px-3 py-2 rounded-lg hover:bg-purple-500/20 flex items-center justify-between group">
                          View Actions <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                       </Link>
                    </div>

                    {/* Cleanup Result */}
                    <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl">
                       <h4 className="text-green-300 font-bold mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4"/> Cleanup</h4>
                       <div className="text-sm text-slate-300 mb-4">
                          {maintenanceResults.cleanup?.actions?.length || 0} zombie issues found that can be closed.
                       </div>
                       <Link to="/cleanup" className="text-xs bg-green-500/10 text-green-400 px-3 py-2 rounded-lg hover:bg-green-500/20 flex items-center justify-between group">
                          View Actions <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                       </Link>
                    </div>
                 </div>
              </div>
            )}
         </div>
      </div>

      {/* 2. Your Common Tools */}
      <div>
         <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-slate-400" />
            Your Workflow
         </h3>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendedTools.map(tool => {
               const Icon = getToolIcon(tool.path);
               const label = getToolLabel(tool.path);
               return (
                  <Link to={tool.path} key={tool.path} className="bg-surface border border-slate-700 p-6 rounded-xl hover:bg-slate-800 transition-colors group">
                     <div className="flex items-start justify-between mb-4">
                        <div className="p-3 bg-slate-900 rounded-lg text-primary group-hover:scale-110 transition-transform">
                           <Icon className="w-6 h-6" />
                        </div>
                        <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-white" />
                     </div>
                     <h4 className="text-lg font-bold text-white mb-1">{label}</h4>
                     <p className="text-sm text-slate-500">
                        {tool.count > 0 ? `Used ${tool.count} times recently` : 'Recommended tool'}
                     </p>
                  </Link>
               );
            })}
         </div>
      </div>

      {/* 3. Executive Briefing (Existing) */}
      <div>
         <h3 className="text-xl font-bold text-white mb-4">Repo Status</h3>
         <AnalysisCard 
           title="Executive Briefing"
           description="AI-generated summary of repo activity."
           status={briefingAnalysis.status}
           result={briefingAnalysis.result}
           onAnalyze={handleGenerateBriefing}
           repoName={repoName}
         />
      </div>
      
    </div>
  );
};

export default Dashboard;
