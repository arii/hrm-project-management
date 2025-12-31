
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { listSessions, deleteSession, sendMessage, getSession } from '../services/julesService';
import { JulesSession } from '../types';
import { TerminalSquare, Trash2, Send, Loader2, RefreshCw, AlertCircle, ExternalLink, MessageSquare } from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import clsx from 'clsx';

interface JulesSessionsProps {
  repoName: string;
  julesApiKey: string;
}

const JulesSessions: React.FC<JulesSessionsProps> = ({ repoName, julesApiKey }) => {
  const [sessions, setSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<JulesSession | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const location = useLocation();
  const initialSessionName = location.state?.viewSessionName;

  const loadSessions = async () => {
    if (!julesApiKey || !julesApiKey.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await listSessions(julesApiKey);
      setSessions(data);
      if (initialSessionName) {
        const session = data.find(s => s.name === initialSessionName);
        if (session) setActiveSession(session);
      }
    } catch (e) {
      console.error('[JulesSessions] Failed to load sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [julesApiKey]);

  const handleSendMessage = async () => {
    if (!activeSession || !messageInput.trim() || !julesApiKey) return;
    setIsSending(true);
    try {
      const shortName = (activeSession.name as string).split('/').pop() || activeSession.name;
      await sendMessage(julesApiKey, shortName, messageInput);
      setMessageInput('');
      const updated = await getSession(julesApiKey, shortName);
      setActiveSession(updated);
      setSessions(prev => prev.map(s => s.name === updated.name ? updated : s));
    } catch (e: any) {
      alert(`Failed to send message: ${e.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteSession = async (sessionName: string) => {
    if (!julesApiKey || !window.confirm("Are you sure you want to delete this session?")) return;
    try {
      const shortName = sessionName.split('/').pop() || sessionName;
      await deleteSession(julesApiKey, shortName);
      setSessions(prev => prev.filter(s => s.name !== sessionName));
      if (activeSession?.name === sessionName) setActiveSession(null);
    } catch (e: any) {
      alert(`Failed to delete session: ${e.message}`);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto h-auto lg:h-[calc(100vh-10rem)] flex flex-col lg:flex-row gap-6">
      {/* Session List Sidebar */}
      <div className="w-full lg:w-[400px] bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden shrink-0">
        <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="font-bold text-white flex items-center gap-2">
            <TerminalSquare className="w-5 h-5 text-purple-400" />
            Sessions
          </h3>
          <Button variant="ghost" size="sm" onClick={loadSessions} isLoading={loading} icon={RefreshCw} className="h-8 w-8 p-0" />
        </div>
        <div className="max-h-60 lg:max-h-none lg:flex-1 overflow-y-auto p-2 space-y-2">
          {loading && sessions.length === 0 ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No active sessions found.</div>
          ) : (
            sessions.map(s => (
              <div 
                key={s.name}
                onClick={() => setActiveSession(s)}
                className={clsx(
                  "p-3 rounded-lg border cursor-pointer transition-all group",
                  activeSession?.name === s.name ? "bg-slate-800 border-purple-500/50" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-mono text-purple-400 truncate pr-2">
                    {s.name.split('/').pop()}
                  </span>
                  <Badge variant={s.state === 'SUCCEEDED' ? 'green' : (s.state === 'FAILED' ? 'red' : 'blue')}>
                    {s.state}
                  </Badge>
                </div>
                <h4 className="text-sm font-medium text-slate-200 line-clamp-1 mb-2">{s.title || 'Untitled Session'}</h4>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500">{new Date(s.createTime).toLocaleDateString()}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.name); }}
                    className="p-1 text-slate-600 hover:text-red-400 lg:opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Session Workspace */}
      <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative min-h-[500px]">
        {activeSession ? (
          <>
            <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
              <div className="min-w-0 pr-4">
                <h3 className="font-bold text-white truncate">{activeSession.title || 'Untitled Session'}</h3>
                <p className="text-[10px] text-slate-500 font-mono truncate">{activeSession.name}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {activeSession.outputs?.some(o => o.pullRequest) && (
                  <a 
                    href={activeSession.outputs.find(o => o.pullRequest)?.pullRequest?.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
                  >
                    Result <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <Badge variant="purple">{activeSession.state}</Badge>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 bg-[#0B1120]/30">
              {activeSession.error && (
                <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-lg flex items-start gap-3 text-red-200 animate-in fade-in">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-sm">Session Error</p>
                    <p className="text-xs opacity-80">{activeSession.error.message}</p>
                  </div>
                </div>
              )}

              <div className="bg-slate-800/40 p-4 lg:p-5 rounded-xl border border-slate-700">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Context Info</h4>
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] text-slate-600 uppercase font-bold block mb-1">Source</span>
                    <span className="text-xs text-slate-300 font-mono break-all bg-slate-900/50 px-2 py-1 rounded inline-block">
                      {activeSession.sourceContext?.source || 'Unknown'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600 uppercase font-bold block mb-1">Branch</span>
                    <Badge variant="slate">{activeSession.sourceContext?.githubRepoContext?.startingBranch || 'leader'}</Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center py-10 lg:py-20 text-slate-500 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10">
                 <MessageSquare className="w-12 h-12 mb-4 opacity-10" />
                 <p className="text-sm font-medium">Interaction History</p>
                 <p className="text-xs opacity-50 max-w-xs text-center mt-2 px-4">Managed within the Jules workflow. Send instructions below.</p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-800/30 shrink-0">
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Send a command..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                />
                <Button 
                  onClick={handleSendMessage} 
                  isLoading={isSending} 
                  disabled={!messageInput.trim()} 
                  className="bg-purple-600 hover:bg-purple-500 border-none shadow-lg shadow-purple-500/20"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-900/10 p-8">
            <TerminalSquare className="w-16 h-16 mb-6 opacity-10" />
            <h3 className="text-lg font-bold text-slate-400">Jules Workspace</h3>
            <p className="text-sm opacity-50 mt-1 text-center">Select a session to begin interacting.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default JulesSessions;
