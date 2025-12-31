
import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, AlertCircle, GitPullRequest, GitMerge, CheckCircle, Upload, Bot, TerminalSquare, Eye, Sparkles, Menu, X, Activity } from 'lucide-react';
import clsx from 'clsx';
import RepoSettings from './RepoSettings';
import { trackPageVisit } from '../services/telemetryService';

interface LayoutProps {
  repoName: string;
  setRepoName: (name: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
  julesApiKey: string;
  setJulesApiKey: (key: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  repoName, setRepoName, 
  githubToken, setGithubToken,
  julesApiKey, setJulesApiKey
}) => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    trackPageVisit(location.pathname);
    setIsMobileMenuOpen(false); // Close menu on navigation
  }, [location.pathname]);

  const navItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/audit', label: 'Technical Audit', icon: Sparkles },
    { path: '/workflow-health', label: 'Workflow Pulse', icon: Activity },
    { path: '/sessions', label: 'Jules Sessions', icon: TerminalSquare },
    { path: '/issues', label: 'Issue Analysis', icon: AlertCircle },
    { path: '/pull-requests', label: 'Pull Requests', icon: GitPullRequest },
    { path: '/code-review', label: 'Code Review', icon: Eye },
    { path: '/agent', label: 'AI Agent', icon: Bot },
    { path: '/cleanup', label: 'Cleanup Report', icon: CheckCircle },
    { path: '/batch-create', label: 'Batch Creator', icon: Upload },
  ];

  const SidebarContent = () => (
    <>
      <div className="p-6 border-b border-slate-700 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <GitMerge className="w-6 h-6" />
            <span className="font-bold text-xl tracking-tight text-white">RepoAuditor</span>
          </div>
          <p className="text-xs text-slate-500 font-medium tracking-wider uppercase">AI-POWERED</p>
        </div>
        <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-slate-400">
          <X className="w-6 h-6" />
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20 font-bold" 
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )
            }
          >
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
         <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-widest">Active Repo</p>
            <p className="text-xs font-mono text-blue-400 truncate" title={repoName}>{repoName}</p>
         </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Desktop Sidebar / Mobile Drawer */}
      <aside className={clsx(
        "bg-surface border-r border-slate-700 flex flex-col fixed h-full z-[70] transition-transform duration-300 lg:translate-x-0 w-64",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <header className="h-16 border-b border-slate-700 bg-surface/50 backdrop-blur-sm sticky top-0 z-40 px-4 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-2 text-slate-400 hover:text-white lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="text-lg lg:text-xl font-bold text-white capitalize truncate max-w-[200px] lg:max-w-none">
              {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
            </h1>
          </div>
          <RepoSettings 
            repoName={repoName} 
            setRepoName={setRepoName}
            githubToken={githubToken}
            setGithubToken={setGithubToken}
            julesApiKey={julesApiKey}
            setJulesApiKey={setJulesApiKey}
          />
        </header>

        <div className="p-4 lg:p-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;
