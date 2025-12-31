
import React, { useState, useEffect } from 'react';
import { Shield, Layout, Zap, FlaskConical, Globe, Cpu, AlertCircle, CheckCircle2, Loader2, Play, Sparkles, ChevronDown, ChevronUp, Plus, Send } from 'lucide-react';
import clsx from 'clsx';
import { fetchCoreRepoContext, createIssue } from '../services/githubService';
import { runTechnicalAudit } from '../services/geminiService';
import { TechnicalAuditResult, AuditAgentType, ProposedIssue } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ReactMarkdown from 'react-markdown';

interface TechnicalAuditProps {
  repoName: string;
  token: string;
}

interface ProposedIssueUI extends ProposedIssue {
  _id: string;
  isExpanded: boolean;
  status: 'idle' | 'creating' | 'success' | 'error';
}

const AGENTS: { id: AuditAgentType, label: string, icon: any, desc: string, color: string }[] = [
  { id: 'full-stack', label: 'Full Stack Expert', icon: Layout, desc: 'Architectural patterns & stack robustness.', color: 'text-blue-400' },
  { id: 'security', label: 'Security Auditor', icon: Shield, desc: 'Vulnerability detection & secret safety.', color: 'text-red-400' },
  { id: 'performance', label: 'Performance Expert', icon: Zap, desc: 'Bottleneck analysis & optimization.', color: 'text-yellow-400' },
  { id: 'testing', label: 'QA Engineer', icon: FlaskConical, desc: 'Coverage gaps & regression risks.', color: 'text-green-400' },
  { id: 'frontend', label: 'UI Architect', icon: Globe, desc: 'Frontend structure & accessibility.', color: 'text-purple-400' },
  { id: 'cicd', label: 'DevOps Specialist', icon: Cpu, desc: 'Pipeline efficiency & automation.', color: 'text-cyan-400' },
];

const TechnicalAudit: React.FC<TechnicalAuditProps> = ({ repoName, token }) => {
  const [selectedAgent, setSelectedAgent] = useState<AuditAgentType>('full-stack');
  const [auditResults, setAuditResults] = useState<Record<string, TechnicalAuditResult>>({});
  const [suggestedIssues, setSuggestedIssues] = useState<ProposedIssueUI[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [isBulkDispatching, setIsBulkDispatching] = useState(false);

  const STORAGE_KEY = `audit_tech_v3_${repoName}`;

  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try { 
        const parsed = JSON.parse(cached);
        setAuditResults(parsed);
        if (parsed[selectedAgent]) {
          setSuggestedIssues(parsed[selectedAgent].suggestedIssues.map((i: any) => ({
            ...i,
            _id: Math.random().toString(36).substr(2, 9),
            isExpanded: false,
            status: 'idle'
          })));
        }
      } catch (e) {}
    }
  }, [repoName]);

  useEffect(() => {
    if (auditResults[selectedAgent]) {
      setSuggestedIssues(auditResults[selectedAgent].suggestedIssues.map((i: any) => ({
        ...i,
        _id: Math.random().toString(36).substr(2, 9),
        isExpanded: false,
        status: 'idle'
      })));
    } else {
      setSuggestedIssues([]);
    }
  }, [selectedAgent]);

  const runAudit = async () => {
    if (!token) return;
    setLoading(true);
    setLoadingStep('Gathering repo context...');
    try {
      const context = await fetchCoreRepoContext(repoName, token);
      setLoadingStep(`AI ${selectedAgent} Agent analyzing...`);
      const result = await runTechnicalAudit(selectedAgent, context);
      
      const nextResults = { ...auditResults, [selectedAgent]: result };
      setAuditResults(nextResults);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextResults));
      
      setSuggestedIssues(result.suggestedIssues.map(i => ({
        ...i,
        _id: Math.random().toString(36).substr(2, 9),
        isExpanded: false,
        status: 'idle'
      })));
    } catch (e: any) {
      alert("Audit failed: " + e.message);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleCreateIssue = async (issue: ProposedIssueUI) => {
    if (!token) return;
    setSuggestedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'creating' } : p));
    try {
      await createIssue(repoName, token, {
        title: issue.title,
        body: `${issue.body}\n\n---\n*Audit Recommendation from ${selectedAgent.replace('-', ' ')} Expert.*`,
        labels: [...issue.labels, 'audit-suggestion', selectedAgent]
      });
      setSuggestedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'success' } : p));
    } catch (e: any) {
      setSuggestedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, status: 'error' } : p));
      alert(`Failed to create issue: ${e.message}`);
    }
  };

  const currentResult = auditResults[selectedAgent];

  return (
    <div className="max-w-[1600px] mx-auto pb-20">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Sparkles className="text-yellow-500 w-8 h-8" />
            Expert Technical Audit
          </h2>
          <p className="text-slate-400">Deploy specialized AI personas to perform deep structural analysis and generate actionable implementation roadmaps.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* AGENT SELECTOR */}
        <div className="lg:col-span-1 space-y-3">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Select Auditor</h3>
          {AGENTS.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              className={clsx(
                "w-full p-4 rounded-xl border text-left transition-all group",
                selectedAgent === agent.id 
                  ? "bg-slate-800 border-primary shadow-lg ring-1 ring-primary/20" 
                  : "bg-surface border-slate-700 hover:bg-slate-800"
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <agent.icon className={clsx("w-5 h-5", agent.color)} />
                <span className={clsx("font-bold text-sm", selectedAgent === agent.id ? "text-white" : "text-slate-400")}>{agent.label}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{agent.desc}</p>
              {auditResults[agent.id] && (
                <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-green-500 uppercase">
                  <CheckCircle2 className="w-3 h-3" /> Analysis Cached
                </div>
              )}
            </button>
          ))}
        </div>

        {/* AUDIT REPORT VIEW */}
        <div className="lg:col-span-2">
          <div className="bg-surface border border-slate-700 rounded-2xl overflow-hidden min-h-[600px] flex flex-col h-full">
            <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Audit Findings
              </h3>
              <Button 
                variant="primary" 
                onClick={runAudit} 
                isLoading={loading} 
                icon={Play}
                size="sm"
              >
                {currentResult ? 'Re-Run Audit' : 'Deploy Agent'}
              </Button>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-[#0B1120]/50">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-96 text-slate-500">
                  <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
                  <p className="text-sm font-medium text-slate-300">{loadingStep}</p>
                </div>
              ) : currentResult ? (
                <div className="animate-in fade-in duration-500 space-y-6">
                  <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-xl flex items-center justify-between">
                     <div className="text-[10px] font-bold text-slate-500 uppercase">Health Score</div>
                     <div className={clsx("text-2xl font-black", currentResult.score > 80 ? "text-green-400" : currentResult.score > 50 ? "text-yellow-400" : "text-red-400")}>{currentResult.score}/100</div>
                  </div>

                  <div className="prose prose-invert prose-blue prose-sm max-w-none">
                    <ReactMarkdown>{currentResult.report}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-600 p-8">
                   <Cpu className="w-12 h-12 text-slate-700 mb-4" />
                   <p className="text-sm">Select an expert auditor and click 'Deploy' to start the analysis.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ROADMAP / ISSUES VIEW */}
        <div className="lg:col-span-2">
          <div className="bg-surface border border-slate-700 rounded-2xl overflow-hidden min-h-[600px] flex flex-col h-full">
            <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center shrink-0">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Step-by-Step Roadmap
               </h3>
               {suggestedIssues.length > 0 && (
                 <Badge variant="blue">{suggestedIssues.length} Proposed</Badge>
               )}
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-900/30">
               {suggestedIssues.length > 0 ? (
                 suggestedIssues.map(issue => (
                   <div key={issue._id} className={clsx(
                     "border rounded-xl transition-all duration-200 overflow-hidden",
                     issue.isExpanded ? "bg-slate-800 border-primary/50 ring-1 ring-primary/20 shadow-xl" : "bg-slate-900 border-slate-700 hover:border-slate-600"
                   )}>
                      <div className="p-4 flex items-start gap-4">
                         <div className="pt-0.5">
                            {issue.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : 
                             issue.status === 'creating' ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> :
                             <div className={clsx("w-2 h-2 rounded-full mt-2", issue.priority === 'High' ? "bg-red-500" : issue.priority === 'Medium' ? "bg-yellow-500" : "bg-blue-500")} />}
                         </div>
                         <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSuggestedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, isExpanded: !p.isExpanded } : p))}>
                            <div className="flex justify-between items-start mb-1">
                               <h4 className="font-bold text-slate-200 text-sm">{issue.title}</h4>
                               {issue.isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-1">{issue.reason}</p>
                            <div className="flex gap-2 mt-3">
                               <Badge variant="slate" className="text-[9px]">{issue.effort}</Badge>
                               <Badge variant="slate" className="text-[9px]">{issue.priority}</Badge>
                            </div>
                         </div>
                         {issue.status === 'idle' && (
                           <Button 
                             size="sm" 
                             variant="primary" 
                             onClick={(e) => { e.stopPropagation(); handleCreateIssue(issue); }}
                             icon={Plus}
                             className="shrink-0"
                           >
                              Extract
                           </Button>
                         )}
                      </div>
                      
                      {issue.isExpanded && (
                        <div className="px-12 pb-4 animate-in slide-in-from-top-2">
                           <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                              <div className="text-[10px] font-bold text-slate-500 uppercase mb-3 tracking-widest">Issue Implementation Plan</div>
                              <div className="prose prose-invert prose-xs prose-blue max-w-none">
                                <ReactMarkdown>{issue.body}</ReactMarkdown>
                              </div>
                           </div>
                           <div className="flex justify-end mt-4">
                              <Button 
                                size="sm" 
                                variant="primary" 
                                onClick={() => handleCreateIssue(issue)}
                                isLoading={issue.status === 'creating'}
                                disabled={issue.status !== 'idle'}
                                icon={Send}
                              >
                                 {issue.status === 'success' ? 'Dispatched' : 'Dispatch to GitHub'}
                              </Button>
                           </div>
                        </div>
                      )}
                   </div>
                 ))
               ) : !loading && (
                 <div className="flex flex-col items-center justify-center h-64 text-slate-600 text-center px-8">
                    <Zap className="w-8 h-8 text-slate-700 mb-3" />
                    <p className="text-xs">No roadmap items yet. The audit will generate structured step-by-step tasks here.</p>
                 </div>
               )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicalAudit;
