
import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, AlertCircle, GitPullRequest, GitMerge, FileText, CheckCircle, Upload, Bot } from 'lucide-react';
import clsx from 'clsx';
import RepoSettings from './RepoSettings';

interface LayoutProps {
  repoName: string;
  setRepoName: (name: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ repoName, setRepoName, githubToken, setGithubToken }) => {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/issues', label: 'Issue Analysis', icon: AlertCircle },
    { path: '/pull-requests', label: 'Pull Requests', icon: GitPullRequest },
    { path: '/agent', label: 'AI Agent', icon: Bot },
    { path: '/cleanup', label: 'Cleanup Report', icon: CheckCircle },
    { path: '/batch-create', label: 'Batch Creator', icon: Upload },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-slate-700 flex flex-col fixed h-full">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-2 text-primary mb-1">
            <GitMerge className="w-6 h-6" />
            <span className="font-bold text-xl tracking-tight">RepoAuditor</span>
          </div>
          <p className="text-xs text-slate-500 font-medium tracking-wider">AI-POWERED ANALYSIS</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
           <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Active Repo</p>
              <p className="text-sm font-mono text-blue-400 truncate" title={repoName}>{repoName}</p>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-700 bg-surface/50 backdrop-blur-sm sticky top-0 z-40 px-8 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white capitalize">
            {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
          </h1>
          <RepoSettings 
            repoName={repoName} 
            setRepoName={setRepoName}
            githubToken={githubToken}
            setGithubToken={setGithubToken}
          />
        </header>

        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
