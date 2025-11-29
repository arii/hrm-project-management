
import React, { useEffect, useState } from 'react';
import { fetchRepoStats, fetchIssues, fetchPullRequests, fetchRecentActivity } from '../services/githubService';
import { generateRepoBriefing } from '../services/geminiService';
import { RepoStats, GithubIssue, GithubPullRequest, AnalysisStatus } from '../types';
import { Activity, GitFork, AlertCircle, GitPullRequest, TrendingUp, AlertTriangle, Calendar, Star, Zap, CheckCircle2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AnalysisCard from '../components/AnalysisCard';
import clsx from 'clsx';
import { useGeminiAnalysis } from '../hooks/useGeminiAnalysis';

interface DashboardProps {
  repoName: string;
  token: string;
}

const Dashboard: React.FC<DashboardProps> = ({ repoName, token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Data State
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [openPrs, setOpenPrs] = useState<GithubPullRequest[]>([]);
  const [urgentIssues, setUrgentIssues] = useState<GithubIssue[]>([]);
  const [velocityData, setVelocityData] = useState<{ date: string, opened: number, closed: number }[]>([]);
  const [stalePrs, setStalePrs] = useState<GithubPullRequest[]>([]);
  
  // AI Insight Hook (Cached)
  const briefingAnalysis = useGeminiAnalysis(generateRepoBriefing, 'dashboard_briefing');

  useEffect(() => {
    loadData();
  }, [repoName, token]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [repoData, prsData, issuesData, activityData] = await Promise.all([
        fetchRepoStats(repoName, token),
        fetchPullRequests(repoName, token, 'open'),
        fetchIssues(repoName, token, 'open'),
        fetchRecentActivity(repoName, token, 30) // Get last 30 days
      ]);
      
      // Update basic stats
      repoData.openPRsCount = prsData.length;
      repoData.openIssuesCount = issuesData.length;
      setStats(repoData);
      setOpenPrs(prsData);

      // Process Urgent Issues (Labeled 'bug', 'urgent', 'p0' or no comments)
      const urgent = issuesData.filter(i => 
        i.labels.some(l => ['bug', 'urgent', 'p0', 'critical'].includes(l.name.toLowerCase()))
      ).slice(0, 5);
      setUrgentIssues(urgent);

      // Process Stale PRs (> 14 days)
      const now = new Date();
      const stale = prsData.filter(pr => {
        const created = new Date(pr.created_at);
        const diffTime = Math.abs(now.getTime() - created.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        return diffDays > 14;
      });
      setStalePrs(stale);

      // Process Velocity (Chart Data)
      const chartMap = new Map<string, { opened: number, closed: number }>();
      // Initialize last 14 days
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        chartMap.set(dateStr, { opened: 0, closed: 0 });
      }

      activityData.forEach(item => {
        const createdDate = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const closedDate = item.state === 'closed' ? new Date(item.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;

        if (chartMap.has(createdDate)) {
           const val = chartMap.get(createdDate)!;
           val.opened++;
        }
        if (closedDate && chartMap.has(closedDate)) {
           const val = chartMap.get(closedDate)!;
           val.closed++;
        }
      });

      setVelocityData(Array.from(chartMap.entries()).map(([date, val]) => ({ date, ...val })));

    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBriefing = async () => {
    if (!stats) return;
    const openedCount = velocityData.reduce((acc, cur) => acc + cur.opened, 0);
    const closedCount = velocityData.reduce((acc, cur) => acc + cur.closed, 0);
      
    // Pass a simplified issue list to the AI to save tokens
    const recentContext = urgentIssues.concat(stalePrs as any).slice(0, 10);
      
    await briefingAnalysis.run(
      stats, 
      { opened: openedCount, closed: closedCount },
      recentContext,
      stalePrs
    );
  };

  // Helper to calculate health grade
  const getHealthGrade = () => {
    if (!stats) return 'C';
    let score = 100;
    if (stalePrs.length > 5) score -= 20;
    if (stats.openIssuesCount > 50) score -= 10;
    if (velocityData.length > 0) {
       const recent = velocityData.slice(-7);
       const closed = recent.reduce((a, b) => a + b.closed, 0);
       const opened = recent.reduce((a, b) => a + b.opened, 0);
       if (closed < opened) score -= 15;
    }
    
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

  const healthGrade = getHealthGrade();
  const gradeColor = healthGrade === 'A' ? 'text-green-400' : healthGrade === 'B' ? 'text-blue-400' : healthGrade === 'C' ? 'text-yellow-400' : 'text-red-400';

  if (loading) return <div className="flex justify-center items-center h-96"><Activity className="w-8 h-8 animate-spin text-primary" /></div>;
  if (error) return <div className="text-red-400 p-4 border border-red-800 rounded-lg bg-red-900/20">Error: {error}. Check your settings.</div>;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Row: AI Briefing & Health Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Health Score Card */}
        <div className="bg-surface border border-slate-700 rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
           <h3 className="text-slate-400 font-medium mb-2 uppercase tracking-wider text-xs">Repo Health Grade</h3>
           <div className={clsx("text-6xl font-black mb-2", gradeColor)}>{healthGrade}</div>
           <div className="flex gap-4 text-sm text-slate-500">
             <span className="flex items-center gap-1"><Star className="w-3 h-3"/> {stats?.stars} Stars</span>
             <span className="flex items-center gap-1"><GitFork className="w-3 h-3"/> {stats?.forks} Forks</span>
           </div>
        </div>

        {/* AI Briefing Card */}
        <div className="lg:col-span-2">
           <AnalysisCard 
             title="Executive Briefing"
             description="Daily AI-generated standup report on repo activity."
             status={briefingAnalysis.status}
             result={briefingAnalysis.result}
             onAnalyze={handleGenerateBriefing}
             repoName={repoName}
           />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-surface border border-slate-700 rounded-xl p-5">
           <div className="flex justify-between items-start mb-2">
             <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400"><GitPullRequest className="w-5 h-5"/></div>
             <span className="text-xs text-slate-500 font-mono">Total Open</span>
           </div>
           <div className="text-3xl font-bold text-white">{stats?.openPRsCount}</div>
           <p className="text-xs text-slate-400 mt-1">Active Pull Requests</p>
        </div>

        <div className="bg-surface border border-slate-700 rounded-xl p-5">
           <div className="flex justify-between items-start mb-2">
             <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400"><AlertTriangle className="w-5 h-5"/></div>
             <span className="text-xs text-amber-500 font-mono font-bold">{stalePrs.length} Critical</span>
           </div>
           <div className="text-3xl font-bold text-white">{stalePrs.length}</div>
           <p className="text-xs text-slate-400 mt-1">Stale PRs ({'>'} 14 days)</p>
        </div>

        <div className="bg-surface border border-slate-700 rounded-xl p-5">
           <div className="flex justify-between items-start mb-2">
             <div className="p-2 bg-rose-500/20 rounded-lg text-rose-400"><AlertCircle className="w-5 h-5"/></div>
             <span className="text-xs text-slate-500 font-mono">Backlog</span>
           </div>
           <div className="text-3xl font-bold text-white">{stats?.openIssuesCount}</div>
           <p className="text-xs text-slate-400 mt-1">Total Open Issues</p>
        </div>

        <div className="bg-surface border border-slate-700 rounded-xl p-5">
           <div className="flex justify-between items-start mb-2">
             <div className="p-2 bg-green-500/20 rounded-lg text-green-400"><TrendingUp className="w-5 h-5"/></div>
             <span className="text-xs text-slate-500 font-mono">Last 14 Days</span>
           </div>
           <div className="text-3xl font-bold text-white flex items-baseline gap-2">
             {velocityData.slice(-14).reduce((a,b) => a + b.closed, 0)}
             <span className="text-sm font-normal text-slate-500">closed</span>
           </div>
           <p className="text-xs text-slate-400 mt-1">Velocity Metric</p>
        </div>
      </div>

      {/* Main Content: Charts & Priority List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Velocity Chart */}
        <div className="lg:col-span-2 bg-surface border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" /> Team Velocity (30 Days)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={velocityData}>
                <defs>
                  <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorClosed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{fontSize: 12}} />
                <YAxis stroke="#64748b" tick={{fontSize: 12}} />
                <Tooltip 
                   contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }}
                   itemStyle={{ fontSize: 12 }}
                />
                <Area type="monotone" dataKey="opened" stroke="#f43f5e" fillOpacity={1} fill="url(#colorOpened)" name="Issues Opened" />
                <Area type="monotone" dataKey="closed" stroke="#22c55e" fillOpacity={1} fill="url(#colorClosed)" name="Issues Closed" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Priority Inbox */}
        <div className="bg-surface border border-slate-700 rounded-xl flex flex-col h-[400px]">
           <div className="p-4 border-b border-slate-700 bg-slate-800/50">
             <h3 className="font-bold text-white flex items-center gap-2">
               <AlertCircle className="w-5 h-5 text-rose-500" /> Priority Inbox
             </h3>
           </div>
           
           <div className="flex-1 overflow-y-auto p-2">
              {stalePrs.length === 0 && urgentIssues.length === 0 && (
                <div className="text-center text-slate-500 py-10">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  No urgent items found.
                </div>
              )}

              {/* Stale PRs */}
              {stalePrs.map(pr => (
                <a key={pr.id} href={pr.html_url} target="_blank" rel="noopener noreferrer" className="block p-3 hover:bg-slate-800/50 rounded-lg group transition-colors border-b border-slate-800 last:border-0">
                   <div className="flex justify-between items-start">
                     <span className="text-sm font-medium text-slate-200 group-hover:text-blue-400 line-clamp-1">{pr.title}</span>
                     <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">Stale PR</span>
                   </div>
                   <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span className="font-mono">#{pr.number}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {new Date(pr.created_at).toLocaleDateString()}</span>
                   </div>
                </a>
              ))}

              {/* Urgent Issues */}
              {urgentIssues.map(issue => (
                <a key={issue.id} href={issue.html_url} target="_blank" rel="noopener noreferrer" className="block p-3 hover:bg-slate-800/50 rounded-lg group transition-colors border-b border-slate-800 last:border-0">
                   <div className="flex justify-between items-start">
                     <span className="text-sm font-medium text-slate-200 group-hover:text-rose-400 line-clamp-1">{issue.title}</span>
                     <span className="text-[10px] bg-rose-500/20 text-rose-500 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">Urgent</span>
                   </div>
                   <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span className="font-mono">#{issue.number}</span>
                      <span>•</span>
                      {issue.labels.slice(0, 2).map(l => (
                        <span key={l.id} className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${l.color}`}} title={l.name} />
                      ))}
                   </div>
                </a>
              ))}
           </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
