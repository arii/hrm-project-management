import React from 'react';
import { Bot, X, Terminal, CheckCircle2, AlertTriangle, Loader2, Send, Key, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Badge from './Badge';
import Button from './Button';
import clsx from 'clsx';
import { JulesSession } from '../../types';

interface WorkerSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  julesApiKey?: string;
  suggestedSessions: JulesSession[];
  allSessions: JulesSession[];
  findingId: string;
  description: string;
  julesReportStatus: Record<string, 'idle' | 'loading' | 'success' | 'error'>;
  onReportToJules: (id: string, sessionName: string, message: string) => void;
  matchingPrNumber?: number;
}

const WorkerSelectorModal: React.FC<WorkerSelectorModalProps> = ({
  isOpen,
  onClose,
  julesApiKey,
  suggestedSessions,
  allSessions,
  findingId,
  description,
  julesReportStatus,
  onReportToJules,
  matchingPrNumber
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  if (!julesApiKey) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden p-8 text-center animate-in fade-in zoom-in-95">
          <Key className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Jules Key Required</h3>
          <p className="text-slate-400 mb-6">You must configure your Jules API Key in Settings to dispatch findings to active sessions.</p>
          <Button variant="primary" onClick={() => { onClose(); navigate('/'); }} icon={Plus}>Go to Settings</Button>
        </div>
      </div>
    );
  }
  
  const suggestedIds = new Set(suggestedSessions.map(s => s.name));
  
  // Sort sessions: 
  // 1. Matches specific PR number (via outputs URL or title)
  // 2. Suggested/Correlated (via repo name)
  // 3. Others
  const sortedSessions = [...allSessions].sort((a, b) => {
    const aPrMatch = matchingPrNumber && (
      a.outputs?.some(o => o.pullRequest?.url?.endsWith(`/${matchingPrNumber}`)) || 
      a.title?.includes(`#${matchingPrNumber}`)
    );
    const bPrMatch = matchingPrNumber && (
      b.outputs?.some(o => o.pullRequest?.url?.endsWith(`/${matchingPrNumber}`)) || 
      b.title?.includes(`#${matchingPrNumber}`)
    );

    if (aPrMatch && !bPrMatch) return -1;
    if (!aPrMatch && bPrMatch) return 1;

    const aCorrelated = suggestedIds.has(a.name);
    const bCorrelated = suggestedIds.has(b.name);

    if (aCorrelated && !bCorrelated) return -1;
    if (!aCorrelated && bCorrelated) return 1;

    return 0;
  });

  const availableSessions = sortedSessions.slice(0, 40);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-800 bg-slate-800/40 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Bot className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-white font-bold">Remediation Worker</h3>
              <p className="text-xs text-slate-500 mt-0.5">Select a recent Jules session to receive this audit finding.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-slate-900/50">
          {availableSessions.length === 0 ? (
            <div className="p-12 text-center text-slate-600">No recent sessions found.</div>
          ) : availableSessions.map(session => {
            const reportKey = `${findingId}-${session.name}`;
            const isDone = julesReportStatus[reportKey] === 'success';
            const isLoading = julesReportStatus[reportKey] === 'loading';
            const isError = julesReportStatus[reportKey] === 'error';
            const isCorrelated = suggestedIds.has(session.name);
            const isPrMatch = matchingPrNumber && (
              session.outputs?.some(o => o.pullRequest?.url?.endsWith(`/${matchingPrNumber}`)) || 
              session.title?.includes(`#${matchingPrNumber}`)
            );

            const prOutput = session.outputs?.find(o => o.pullRequest);

            return (
              <button 
                key={session.name}
                disabled={isDone || isLoading}
                onClick={() => onReportToJules(findingId, session.name, description)}
                className={clsx(
                  "w-full text-left px-5 py-4 rounded-xl mb-1 transition-all flex items-center justify-between group/row border",
                  isDone ? "bg-green-500/5 border-green-500/20 cursor-default" : 
                  isError ? "bg-red-500/5 border-red-500/20" :
                  isPrMatch ? "bg-blue-500/5 border-blue-500/20 hover:bg-slate-800" :
                  "bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700"
                )}
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx("font-bold truncate", 
                      isDone ? "text-green-400" : 
                      isError ? "text-red-400" : 
                      isPrMatch ? "text-blue-400" :
                      "text-slate-200 group-hover/row:text-white"
                    )}>
                      {session.title || session.name.split('/').pop()}
                    </span>
                    {isPrMatch && <Badge variant="blue" className="text-[8px] py-0">PR Match</Badge>}
                    {isCorrelated && !isPrMatch && <Badge variant="slate" className="text-[8px] py-0">Repo Match</Badge>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                      <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {session.name.split('/').pop()}</span>
                      <span className="h-1 w-1 bg-slate-700 rounded-full" />
                      <span className={clsx("uppercase font-bold tracking-tighter opacity-80", 
                        session.state === 'COMPLETED' || session.state === 'SUCCEEDED' ? "text-green-500/60" : 
                        session.state === 'FAILED' ? "text-red-500/60" : "text-slate-500"
                      )}>{session.state}</span>
                    </div>
                    {prOutput?.pullRequest && (
                      <div className="text-[9px] text-blue-500/70 font-medium flex items-center gap-1 truncate">
                        Linked PR: {prOutput.pullRequest.title || prOutput.pullRequest.url.split('/').pop()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full transition-colors">
                  {isDone ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : isError ? <AlertTriangle className="w-6 h-6 text-red-500" /> : isLoading ? <Loader2 className="w-6 h-6 animate-spin text-purple-400" /> : (
                    <div className="p-2 bg-slate-800 rounded-lg group-hover/row:bg-purple-600 transition-colors">
                      <Send className="w-4 h-4 text-slate-400 group-hover/row:text-white" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WorkerSelectorModal;
