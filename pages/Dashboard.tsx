
import React from 'react';
import { Link } from 'react-router-dom';
import { GitPullRequest, Eye, Activity, PlusCircle, ArrowRight, Github, Terminal } from 'lucide-react';

interface DashboardProps {
  repoName: string;
}

const Dashboard: React.FC<DashboardProps> = ({ repoName }) => {
  const tools = [
    {
      title: 'Pull Requests',
      description: 'Review open PRs, check health, and run AI repair sessions.',
      path: '/pull-requests',
      icon: GitPullRequest,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      borderColor: 'border-purple-500/20'
    },
    {
      title: 'Code Review',
      description: 'Deep architectural analysis of PR diffs with Anti-Slop directives.',
      path: '/code-review',
      icon: Eye,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20'
    },
    {
      title: 'Workflow Pulse',
      description: 'Monitor CI/CD health, analyze failures, and optimize performance.',
      path: '/workflow-health',
      icon: Activity,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/20'
    },
    {
      title: 'Batch Creator',
      description: 'Quickly generate multiple GitHub issues from raw text or notes.',
      path: '/batch-create',
      icon: PlusCircle,
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/20'
    },
    {
      title: 'Jules Sessions',
      description: 'Manage and clean up your AI repair sessions to free up quota.',
      path: '/jules-management',
      icon: Terminal,
      color: 'text-rose-400',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20'
    }
  ];

  return (
    <div className="max-w-6xl mx-auto py-12 px-4">
      <div className="text-center mb-16">
        <div className="inline-flex items-center justify-center p-3 bg-slate-800 rounded-2xl mb-6 border border-slate-700 shadow-xl">
          <Github className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">RepoAuditor</h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto">
          A focused toolkit for maintaining high-quality repositories. 
          No background noise, just the tools you need.
        </p>
        {repoName && (
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-full text-slate-300 text-sm font-mono">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {repoName}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tools.map((tool) => (
          <Link 
            key={tool.path} 
            to={tool.path}
            className={`group relative bg-slate-900/50 border ${tool.borderColor} p-8 rounded-2xl hover:bg-slate-800 transition-all duration-300 hover:shadow-2xl hover:shadow-black/40`}
          >
            <div className="flex items-start justify-between">
              <div className={`p-4 ${tool.bgColor} rounded-xl ${tool.color} mb-6 group-hover:scale-110 transition-transform duration-300`}>
                <tool.icon className="w-8 h-8" />
              </div>
              <ArrowRight className="w-6 h-6 text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            
            <h3 className="text-2xl font-bold text-white mb-2">{tool.title}</h3>
            <p className="text-slate-400 text-lg leading-relaxed">
              {tool.description}
            </p>
            
            <div className="mt-8 flex items-center text-sm font-medium text-slate-500 group-hover:text-white transition-colors">
              Launch Tool
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-20 pt-12 border-top border-slate-800 text-center">
        <p className="text-slate-500 text-sm">
          RepoAuditor v2.0 • Focused on Minimalism & Performance
        </p>
      </div>
    </div>
  );
};

export default Dashboard;
