
import React, { useState, useEffect, useCallback } from 'react';
import { listSessions, deleteSession, getSession, getSessionUrl, sendMessage } from '../services/julesService';
import { JulesSession, EnrichedPullRequest } from '../types';
import { Trash2, RefreshCw, AlertCircle, CheckCircle2, Loader2, Search, ExternalLink, GitPullRequest, GitBranch, Shield, ShieldCheck, ShieldAlert, ShieldQuestion, Send, Check, Activity, Rocket, Zap } from 'lucide-react';
import Button from '../components/ui/Button';
import { storage } from '../services/storageService';
import { enrichSinglePr } from '../services/githubService';
import Badge from '../components/ui/Badge';
import clsx from 'clsx';
import ConfirmModal from '../components/ui/ConfirmModal';
import { useAutoSendFix } from '../hooks/useAutoSendFix';
import { useJulesSessions } from '../hooks/useJulesSessions';
import { useQueryClient } from '@tanstack/react-query';

interface JulesManagementProps {
  julesApiKey: string;
  repoName: string;
}

const CiStatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) return null;

  const config = {
    passed: { color: 'text-emerald-400', icon: ShieldCheck, label: 'Checks Passed' },
    failed: { color: 'text-red-400', icon: ShieldAlert, label: 'Checks Failed' },
    pending: { color: 'text-yellow-400', icon: Loader2, label: 'Checks Pending' },
  }[status] || { color: 'text-slate-400', icon: ShieldQuestion, label: 'Checks Unknown' };

  const Icon = config.icon;

  return (
    <div className={clsx("flex items-center gap-1.5 font-bold uppercase tracking-tighter text-[9px]", config.color)} title={config.label}>
      <Icon className={clsx("w-3 h-3", status === 'pending' && "animate-spin")} />
      <span>{config.label}</span>
    </div>
  );
};

const JulesManagement: React.FC<JulesManagementProps> = ({ julesApiKey, repoName }) => {
  const queryClient = useQueryClient();
  const {
    allSessions: sessions,
    isLoading: loading,
    isEnriching,
    refetchSessions
  } = useJulesSessions(julesApiKey, repoName);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'date' | 'status' | 'name' | 'prStatus'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [ciStatuses, setCiStatuses] = useState<Record<string, { status: string, prNumber: number, url: string, prData?: EnrichedPullRequest }>>({});

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
      return;
    }

    setError(null);
    setIsRefreshing(true);
    try {
      await refetchSessions(force);
      setSelectedIds(new Set()); // Reset selection on reload
    } catch (e: any) {
      setError(e.message || "Failed to load sessions");
    } finally {
      setIsRefreshing(false);
    }
  }, [julesApiKey, refetchSessions]);

  const { enabled, setEnabled, lastRun, nextRun, isChecking, autoHealLogs, getSentTime } = useAutoSendFix(julesApiKey, storage.getRepo(), loadSessions);

  const fetchCiStatusesForSessions = async (sessionsList: JulesSession[], skipCache = false) => {
    const ghToken = storage.getGithubToken();
    if (!ghToken) return;

    const prsToFetch: Array<{ sessionName: string, repo: string, number: number, url: string }> = [];

    sessionsList.forEach(session => {
      if (!session.outputs) return;
      
      const prs = session.outputs
        .filter(o => o.pullRequest?.url)
        .map(o => {
          const url = o.pullRequest!.url;
          const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          return match ? { repo: match[1], number: parseInt(match[2], 10), url } : null;
        })
        .filter(p => p !== null) as Array<{ repo: string, number: number, url: string }>;

      if (prs.length > 0) {
        // Find highest numbered PR (suggested by user if multiple)
        const highestPr = prs.reduce((prev, curr) => (curr.number > prev.number ? curr : prev), prs[0]);
        prsToFetch.push({ sessionName: session.name, ...highestPr });
      }
    });

    // Fetch CI statuses in parallel (limit to 3 at a time to be safe with rate limits)
    const chunkSize = 3;
    for (let i = 0; i < prsToFetch.length; i += chunkSize) {
      const chunk = prsToFetch.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (item) => {
        try {
          // We use enrichSinglePr but we need a minimal GithubPullRequest object
          const prObj = {
            number: item.number,
            head: { sha: '' } // enrichSinglePr handles empty SHA by fetching details
          } as any;
          
          const enriched = await enrichSinglePr(item.repo, prObj, ghToken, false, skipCache);
          setCiStatuses(prev => ({
            ...prev,
            [item.sessionName]: { 
              status: enriched.testStatus, 
              prNumber: item.number,
              url: item.url,
              prData: enriched
            }
          }));
        } catch (e: any) {
          console.warn(`[JulesManagement] Failed to fetch CI status for PR #${item.number} in repo ${item.repo}:`, e?.message || e);
        }
      }));
    }
  };

  useEffect(() => {
    if (sessions && sessions.length > 0) {
      fetchCiStatusesForSessions(sessions);
    }
  }, [sessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const handleSendMessage = async (sessionName: string, text: string, successLabel: string) => {
    setActionLoading(prev => ({ ...prev, [sessionName]: true }));
    try {
      await sendMessage(julesApiKey, sessionName, text);
      showSuccess(`Successfully sent "${successLabel}" command to session.`);
      loadSessions(true); // Background refresh
    } catch (e: any) {
      setError(`Failed to send message: ${e.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [sessionName]: false }));
    }
  };

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
          queryClient.setQueryData<JulesSession[]>(['julesSessions', julesApiKey], prev => {
            return prev ? prev.filter(s => s.name !== sessionName) : [];
          });
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
            // Update cache immediately for visual feedback
            queryClient.setQueryData<JulesSession[]>(['julesSessions', julesApiKey], prev => {
              return prev ? prev.filter(s => s.name !== sessionName) : [];
            });
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

  const handleSort = (field: 'date' | 'status' | 'name' | 'prStatus') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const filteredSessions = sessions.filter(s => {
    const searchLow = searchTerm.toLowerCase();
    const hasPrMatch = s.outputs?.some(o => 
      o.pullRequest?.url?.toLowerCase().includes(searchLow) || 
      o.pullRequest?.title?.toLowerCase().includes(searchLow)
    );
    const matchesSearch = (
      s.title?.toLowerCase().includes(searchLow) || 
      s.name.toLowerCase().includes(searchLow) ||
      hasPrMatch
    );

    if (!matchesSearch) return false;

    const isActive = s.state === 'RUNNING' || s.state === 'IN_PROGRESS' || s.state === 'PENDING' || s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'AWAITING_PLAN_APPROVAL';
    if (statusFilter === 'ACTIVE') return isActive;
    if (statusFilter === 'ARCHIVED') return !isActive;
    
    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortField === 'date') {
      const timeA = a.createTime ? new Date(a.createTime).getTime() : 0;
      const timeB = b.createTime ? new Date(b.createTime).getTime() : 0;
      comparison = timeA - timeB;
    } else if (sortField === 'status') {
      comparison = (a.state || '').localeCompare(b.state || '');
    } else if (sortField === 'prStatus') {
      const getPrStatusValue = (s: JulesSession) => {
        const pr = ciStatuses[s.name]?.prData;
        if (!pr) return 0;
        const stateLower = (pr.state || 'open').toLowerCase().trim();
        const hasMergedAt = !!(pr.merged_at && pr.merged_at !== 'null' && pr.merged_at !== 'undefined');
        // Merged > Open > Draft > Closed > None
        if (stateLower === 'merged' || hasMergedAt) return 4;
        if (stateLower === 'closed') return 1;
        return pr.draft ? 2 : 3;
      };
      comparison = getPrStatusValue(a) - getPrStatusValue(b);
    } else {
      comparison = (a.title || a.name).localeCompare(b.title || b.name);
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  const isStale = (session: JulesSession) => {
    if (!session.createTime) return false;
    const created = new Date(session.createTime).getTime();
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const isActive = session.state === 'RUNNING' || session.state === 'IN_PROGRESS' || session.state === 'PENDING' || session.state === 'AWAITING_USER_FEEDBACK' || session.state === 'AWAITING_PLAN_APPROVAL';
    return !isActive && (now - created > threeDaysMs);
  };

  const toggleSelect = (id: string, event?: React.MouseEvent) => {
    // Prevent selection if clicking a link or button
    if (event) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a') || target.closest('button')) {
        return;
      }
    }

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

  const getPrStatusBadge = (session: JulesSession, pr?: EnrichedPullRequest) => {
    const hasPr = session.outputs?.some(o => o.pullRequest?.url);
    if (!hasPr) {
      return <span className="text-slate-500 font-mono text-xs">—</span>;
    }

    if (isEnriching && !pr) {
        return <div className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3 h-3 animate-spin text-purple-500" /> Loading...</div>;
    }
    if (!pr) return null;
    
    let label = 'Unknown';
    let variant: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray' | 'slate' = 'slate';
    
    const stateLower = (pr.state || 'open').toLowerCase().trim();
    const hasMergedAt = !!(pr.merged_at && pr.merged_at !== 'null' && pr.merged_at !== 'undefined');
    
    // Improved PR state logic to fix inaccurate statuses
    if (stateLower === 'merged' || hasMergedAt) {
        label = 'Merged';
        variant = 'purple';
    } else if (stateLower === 'closed') {
        label = 'Closed';
        variant = 'red';
    } else if (pr.draft) {
        label = 'Draft';
        variant = 'yellow';
    } else {
        label = 'Open';
        variant = 'green';
    }
    
    return <Badge variant={variant}>{label}</Badge>;
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
            variant={enabled ? "secondary" : "primary"}
            size="sm"
            onClick={() => setEnabled(!enabled)}
            className={clsx("flex items-center gap-2", enabled ? "text-emerald-400" : "")}
          >
            <Zap className="w-3 h-3" />
            {enabled ? "Auto-Fix Enabled" : "Start Auto-Fix"}
          </Button>
          {enabled && nextRun && (
            <span className="text-xs text-slate-500 border-l border-slate-600 pl-2">
              Next: {nextRun.toLocaleTimeString()}
            </span>
          )}
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => loadSessions(false, true)} 
            disabled={loading || isRefreshing || isDeletingBulk}
            isLoading={isRefreshing}
            icon={RefreshCw}
          >
            Refresh
          </Button>
          <Button 
            variant="danger" 
            size="sm" 
            onClick={handleDeleteSelected} 
            disabled={loading || isRefreshing || isDeletingBulk || selectedIds.size === 0}
            isLoading={isDeletingBulk}
            icon={Trash2}
          >
            Delete Selected ({selectedIds.size})
          </Button>
        </div>
      </div>

      {enabled && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-25"></div>
                <div className="relative w-3 h-3 bg-emerald-500 rounded-full"></div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  Auto-Fix Daemon Active
                  {isChecking && (
                    <span className="text-xs text-emerald-400 animate-pulse flex items-center gap-1 font-normal">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning checks...
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically heals Pull Requests with failing CI tests by prompting the Jules agent.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
              <div>
                <span className="text-slate-500">Last Run:</span> {lastRun ? new Date(lastRun).toLocaleTimeString() : 'Never'}
              </div>
              <div className="hidden md:block h-4 w-px bg-slate-800"></div>
              <div>
                <span className="text-slate-500">Next Run:</span> {nextRun ? nextRun.toLocaleTimeString() : 'Scheduled'}
              </div>
            </div>
          </div>

          <div className="border-t border-emerald-500/20 pt-3">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest block mb-2 font-mono">Daemon Activity Log</span>
            {Object.keys(autoHealLogs).length === 0 ? (
              <span className="text-xs text-slate-500 italic block">No auto-fix actions triggered in this session yet. Active monitoring in progress...</span>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                {Object.entries(autoHealLogs).map(([sessionName, timestamp]) => {
                  const sessionId = sessionName.split('/').pop();
                  return (
                    <div key={sessionName} className="flex items-center justify-between text-xs font-mono text-emerald-300 bg-emerald-950/20 p-2 rounded border border-emerald-500/10">
                      <span className="truncate">Auto-healed session <strong className="text-white">{sessionId}</strong></span>
                      <span className="text-[10px] text-slate-500 shrink-0">{new Date(timestamp).toLocaleTimeString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

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

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
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
              Loading status...
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-900 border border-slate-700 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="ARCHIVED">Archived/Stale</option>
          </select>

          <select 
            value={`${sortField}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortField(field as any);
              setSortOrder(order as any);
            }}
            className="bg-slate-900 border border-slate-700 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="status-asc">Status (A-Z)</option>
            <option value="status-desc">Status (Z-A)</option>
            <option value="name-asc">Name (A-Z)</option>
          </select>
        </div>
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
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white" onClick={() => handleSort('name')}>Session</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white" onClick={() => handleSort('date')}>Created</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white" onClick={() => handleSort('prStatus')}>PR Status</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white" onClick={() => handleSort('status')}>Status</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredSessions.map((session) => {
                  const sessionCi = ciStatuses[session.name];
                  return (
                    <tr 
                      key={session.name} 
                      onClick={(e) => toggleSelect(session.name, e)}
                      className={clsx(
                        "hover:bg-slate-800/30 transition-colors group cursor-pointer",
                        selectedIds.has(session.name) && "bg-purple-500/5",
                        isStale(session) && "opacity-60 grayscale-[0.5]"
                      )}
                    >
                    <td className="p-4">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500/50 transition-all"
                        checked={selectedIds.has(session.name)}
                        readOnly
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
                          {getSentTime(session.name) && (
                            <Badge variant="yellow" className="text-[10px] py-0 px-1.5">
                              Request sent @ {new Date(getSentTime(session.name)!).toLocaleTimeString()}
                            </Badge>
                          )}
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
                        
                        {session.outputs?.map((out, idx) => {
                          const isDisplayPr = sessionCi && out.pullRequest?.url === sessionCi.url;
                          return out.pullRequest && (
                            <div key={idx} className="mt-1.5 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
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
                                {isDisplayPr && <CiStatusBadge status={sessionCi.status} />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-400">
                      {session.createTime ? new Date(session.createTime).toLocaleString() : 'Unknown'}
                    </td>
                    <td className="p-4">
                      {getPrStatusBadge(session, sessionCi?.prData)}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={(session.state === 'IN_PROGRESS' || session.state === 'RUNNING') ? 'green' : 'gray'}>
                          {session.state || 'UNKNOWN'}
                        </Badge>
                        {isStale(session) && (
                          <span className="px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded text-[8px] font-black uppercase tracking-widest border border-slate-700">
                            Stale
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleSendMessage(session.name, "Please publish your changes.", "Publish")}
                          disabled={actionLoading[session.name] || deletingIds.has(session.name)}
                          className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all disabled:opacity-50"
                          title="Publish Changes"
                        >
                          {actionLoading[session.name] ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Rocket className="w-4 h-4" />
                          )}
                        </button>
                        {sessionCi?.status === 'failed' && (
                          <button 
                            onClick={() => handleSendMessage(session.name, "Please fix the CI errors in this pull request.", "Fix CI")}
                            disabled={actionLoading[session.name] || deletingIds.has(session.name)}
                            className="p-2 text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-all disabled:opacity-50"
                            title="Fix CI Errors"
                          >
                            {actionLoading[session.name] ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                          </button>
                        )}
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
                );
              })}
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
