
import React, { useState, useEffect, useCallback } from 'react';
import { listSessions, deleteSession, enrichSessionsWithDetails, getSessionUrl } from '../services/julesService';
import { JulesSession } from '../types';
import { Trash2, RefreshCw, AlertCircle, CheckCircle2, Loader2, Search, ExternalLink, GitPullRequest, GitBranch } from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import clsx from 'clsx';
import ConfirmModal from '../components/ui/ConfirmModal';

interface JulesManagementProps {
  julesApiKey: string;
}

const JulesManagement: React.FC<JulesManagementProps> = ({ julesApiKey }) => {
  const [sessions, setSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);

  // Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const loadSessions = useCallback(async (silent = false, force = false) => {
    if (!julesApiKey) {
      setError("Jules API Key is missing. Please check your settings.");
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await listSessions(julesApiKey, force);
      // Sort by creation time descending (most recent first)
      const sorted = [...data].sort((a, b) => {
        const timeA = a.createTime ? new Date(a.createTime).getTime() : 0;
        const timeB = b.createTime ? new Date(b.createTime).getTime() : 0;
        return timeB - timeA;
      });
      setSessions(sorted);
      setSelectedIds(new Set()); // Reset selection on reload

      // Background enrichment
      setIsEnriching(true);
      try {
        const enriched = await enrichSessionsWithDetails(julesApiKey, sorted);
        setSessions(enriched);
      } catch (e) {
        console.warn("[JulesManagement] Enrichment failed:", e);
      } finally {
        setIsEnriching(false);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [julesApiKey]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDeleteSession = (sessionName: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Session',
      message: 'Are you sure you want to delete this session? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setDeletingIds(prev => new Set(prev).add(sessionName));
        try {
          await deleteSession(julesApiKey, sessionName);
          setSessions(prev => prev.filter(s => s.name !== sessionName));
          setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(sessionName);
            return next;
          });
          showSuccess("Session deleted successfully.");
        } catch (e: any) {
          setError(`Failed to delete session: ${e.message}`);
        } finally {
          setDeletingIds(prev => {
            const next = new Set(prev);
            next.delete(sessionName);
            return next;
          });
        }
      }
    });
  };

  const handleDeleteSelected = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Sessions',
      message: `Are you sure you want to delete ${count} selected sessions? This action cannot be undone.`,
      confirmText: `Delete ${count} Sessions`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsDeletingBulk(true);
        let successCount = 0;
        let failCount = 0;

        const idsToDelete = Array.from(selectedIds);

        for (const sessionName of idsToDelete) {
          try {
            await deleteSession(julesApiKey, sessionName);
            successCount++;
            // Update local state immediately for visual feedback
            setSessions(prev => prev.filter(s => s.name !== sessionName));
            setSelectedIds(prev => {
              const next = new Set(prev);
              next.delete(sessionName);
              return next;
            });
          } catch (e) {
            failCount++;
          }
        }

        setIsDeletingBulk(false);
        if (failCount > 0) {
          setError(`Deleted ${successCount} sessions. ${failCount} failed.`);
        } else if (successCount > 0) {
          showSuccess(`Successfully deleted ${successCount} sessions.`);
        }
        loadSessions(true); // Silent reload to sync with server
      }
    });
  };

  const filteredSessions = sessions.filter(s => {
    const searchLow = searchTerm.toLowerCase();
    const hasPrMatch = s.outputs?.some(o => 
      o.pullRequest?.url?.toLowerCase().includes(searchLow) || 
      o.pullRequest?.title?.toLowerCase().includes(searchLow)
    );
    return (
      s.title?.toLowerCase().includes(searchLow) || 
      s.name.toLowerCase().includes(searchLow) ||
      hasPrMatch
    );
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSessions.length && filteredSessions.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSessions.map(s => s.name)));
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Jules Sessions</h1>
          <p className="text-slate-400 mt-1">Manage your AI repair and analysis sessions.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => loadSessions(false, true)} 
            disabled={loading || isDeletingBulk}
            icon={RefreshCw}
            className={loading ? 'animate-spin' : ''}
          >
            Refresh
          </Button>
          <Button 
            variant="danger" 
            size="sm" 
            onClick={handleDeleteSelected} 
            disabled={loading || isDeletingBulk || selectedIds.size === 0}
            isLoading={isDeletingBulk}
            icon={Trash2}
          >
            Delete Selected ({selectedIds.size})
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/50 rounded-xl flex items-center gap-3 text-green-400 animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="w-5 h-5" />
          <p>{successMessage}</p>
        </div>
      )}

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input 
          type="text"
          placeholder="Search sessions by title, ID, or PR URL..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
        />
        {isEnriching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-[10px] text-purple-400 font-medium">
            <Loader2 className="w-3 h-3 animate-spin" />
            Enriching PR info...
          </div>
        )}
      </div>

      <div className="bg-slate-900/50 border border-slate-700 rounded-2xl overflow-hidden">
        {loading && sessions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-500">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p>Fetching sessions from Jules API...</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-500">
            <CheckCircle2 className="w-10 h-10 mb-4 opacity-20" />
            <p>{searchTerm ? 'No sessions match your search.' : 'No active sessions found.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/50">
                  <th className="p-4 w-10">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500/50 transition-all cursor-pointer"
                      checked={selectedIds.size === filteredSessions.length && filteredSessions.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Session</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Created</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredSessions.map((session) => (
                  <tr 
                    key={session.name} 
                    className={clsx(
                      "hover:bg-slate-800/30 transition-colors group",
                      selectedIds.has(session.name) && "bg-purple-500/5"
                    )}
                  >
                    <td className="p-4">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500/50 transition-all cursor-pointer"
                        checked={selectedIds.has(session.name)}
                        onChange={() => toggleSelect(session.name)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <a 
                            href={getSessionUrl(session.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white font-medium hover:text-purple-400 transition-colors truncate max-w-xs xl:max-w-md"
                          >
                            {session.title || 'Untitled Session'}
                          </a>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                          <span className="flex items-center gap-1 opacity-70">
                            ID: {session.name.split('/').pop()}
                          </span>
                          {session.sourceContext?.githubRepoContext?.startingBranch && (
                            <span className="flex items-center gap-1 text-purple-400/70">
                              <GitBranch className="w-3 h-3" />
                              {session.sourceContext.githubRepoContext.startingBranch}
                            </span>
                          )}
                        </div>
                        
                        {session.outputs?.map((out, idx) => out.pullRequest && (
                          <div key={idx} className="mt-1.5 flex flex-col gap-1">
                            <div className="flex items-center gap-2 py-1 px-2 bg-blue-500/10 border border-blue-500/20 rounded text-[10px] text-blue-400 w-fit max-w-[300px]">
                              <GitPullRequest className="w-3 h-3 shrink-0" />
                              <span className="truncate font-bold tracking-tight">PR: {out.pullRequest.title || out.pullRequest.url.split('/').pop()}</span>
                              <a 
                                href={out.pullRequest.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="ml-1 hover:text-white transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-400">
                      {session.createTime ? new Date(session.createTime).toLocaleString() : 'Unknown'}
                    </td>
                    <td className="p-4">
                      <Badge variant={(session.state === 'IN_PROGRESS' || session.state === 'RUNNING') ? 'green' : 'gray'}>
                        {session.state || 'UNKNOWN'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleDeleteSession(session.name)}
                          disabled={deletingIds.has(session.name) || isDeletingBulk}
                          className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all disabled:opacity-50"
                          title="Delete Session"
                        >
                          {deletingIds.has(session.name) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8 p-6 bg-slate-800/30 border border-slate-700 rounded-2xl">
        <h3 className="text-lg font-bold text-white mb-2">About Session Management</h3>
        <p className="text-slate-400 text-sm leading-relaxed">
          Jules sessions are stored on Google's infrastructure. Deleting a session here will permanently remove it from your account. 
          If you are hitting quota limits or want to clean up your workspace, use the "Delete All" feature to purge your session history.
        </p>
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
      />
    </div>
  );
};

export default JulesManagement;
