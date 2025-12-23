
import React, { useState, useEffect, useMemo } from 'react';
import { listSessions, createSession, findSourceForRepo, sendMessage, deleteSession } from '../services/julesService';
import { JulesSession } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { TerminalSquare, RefreshCw, Plus, MessageSquare, Play, Trash2, GitPullRequest, GitBranch, ExternalLink, Send, AlertTriangle, Filter, Layers, Clock, CheckCircle2, XCircle, PauseCircle, Eraser, CheckSquare, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';

interface JulesSessionsProps {
  repoName: string;
  julesApiKey: string;
}

type SortMode = 'recent' | 'grouped';
type FilterStatus = 'all' | 'active' | 'completed' | 'failed';

type ProcessedSessions = 
  | { type: 'list'; items: JulesSession[] }
  | { type: 'grouped'; groups: Record<string, JulesSession[]>; others: JulesSession[] };

const JulesSessions: React.FC<JulesSessionsProps> = ({ repoName, julesApiKey }) => {
  const [sessions, setSessions] = useState<JulesSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // View Controls
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [newBranch, setNewBranch] = useState('leader');
  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Active Session (Chat) State
  const [activeSession, setActiveSession] = useState<JulesSession | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Bulk Cleanup State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSessionNames, setSelectedSessionNames] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingSessionName, setDeletingSessionName] = useState<string | null>(null);

  // Check for navigation state (e.g. create from Issue)
  const location = useLocation();
  const locState = location.state as { createFromIssue?: { title: string; number: number; body: string }; viewSessionName?: string } | null;

  useEffect(() => {
    // Check if we navigated here with intent to create
    if (locState && locState.createFromIssue) {
      const { title, number, body } = locState.createFromIssue;
      setNewTitle(`Fix: ${title} (#${number})`);
      setNewPrompt(`Task: ${title}\n\nContext from Issue #${number}:\n${body}\n\nPlease address this issue.`);
      setNewBranch(`fix/issue-${number}`);
      setIsCreateOpen(true);
      // Clear state so refresh doesn't reopen
      window.history.replaceState({}, document.title);
    }
  }, [locState]);

  useEffect(() => {
    if (julesApiKey) {
      loadSessions();
    }
  }, [julesApiKey]);

  // Handle deep link to specific session (View Active Session) OR Restore from Storage
  useEffect(() => {
    // Priority 1: Navigation State (Deep Link)
    if (locState?.viewSessionName && sessions.length > 0) {
       const target = sessions.find(s => s.name === locState.viewSessionName);
       if (target) {
         setActiveSession(target);
         // Clear state to avoid stickiness
         window.history.replaceState({}, document.title);
         return;
       }
    }

    // Priority 2: Session Storage (Restore last viewed)
    if (!activeSession && sessions.length > 0) {
      const lastActive = sessionStorage.getItem('jules_last_active_session');
      if (lastActive) {
        const target = sessions.find(s => s.name === lastActive);
        if (target) {
          setActiveSession(target);
        }
      }
    }
  }, [sessions, locState]); // Dependencies: run when sessions load

  // Persist Active Session Selection
  useEffect(() => {
    if (activeSession) {
      sessionStorage.setItem('jules_last_active_session', activeSession.name);
    }
  }, [activeSession]);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSessions(julesApiKey);
      // Sort by create time descending
      const sorted = data.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
      setSessions(sorted);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Identify Cleanup Candidates ---
  const cleanupCandidates = useMemo(() => {
    const candidates = new Map<string, string>(); // name -> reason
    const failedStates = ['FAILED', 'CANCELLED', 'TERMINATED'];
    
    sessions.forEach(s => {
      if (failedStates.includes(s.state)) {
        candidates.set(s.name, `Failed (${s.state})`);
        return;
      }
      const daysOld = (Date.now() - new Date(s.createTime).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld > 7) {
         candidates.set(s.name, `Stale (${Math.floor(daysOld)} days old)`);
      }
    });
    return candidates;
  }, [sessions]);

  // --- Processed Sessions for Sidebar ---
  const processedSessions = useMemo((): ProcessedSessions => {
    // 1. Filter Logic
    let filtered = sessions;
    const activeStates = ['RUNNING', 'PENDING', 'IN_PROGRESS', 'AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'];
    const completedStates = ['SUCCEEDED', 'COMPLETED'];
    const failedStates = ['FAILED', 'CANCELLED', 'TERMINATED'];

    if (filterStatus === 'active') {
      filtered = sessions.filter(s => activeStates.includes(s.state));
    } else if (filterStatus === 'completed') {
      filtered = sessions.filter(s => completedStates.includes(s.state));
    } else if (filterStatus === 'failed') {
      filtered = sessions.filter(s => failedStates.includes(s.state));
    }

    if (sortMode === 'recent') {
      return { type: 'list', items: filtered };
    } else {
      // Group by Branch or PR
      const groups: Record<string, JulesSession[]> = {};
      const others: JulesSession[] = [];

      filtered.forEach(s => {
         const branch = s.sourceContext?.githubRepoContext?.startingBranch;
         // Heuristic: Group by branch if it's a feature branch (not leader/main/master)
         const isLeader = ['leader', 'main', 'master', 'dev', 'develop'].includes(branch || '');
         
         // Or try to group by common Issue # in title
         const issueMatch = (s.title || '').match(/#(\d+)/);
         const groupKey = issueMatch ? `Issue #${issueMatch[1]}` : (!isLeader && branch ? branch : 'Other');

         if (groupKey === 'Other') {
            others.push(s);
         } else {
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(s);
         }
      });

      return { type: 'grouped', groups, others };
    }
  }, [sessions, sortMode, filterStatus]);

  const handleCreate = async () => {
    if (!newPrompt) return;
    setIsCreating(true);
    try {
      // 1. Find Source
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) {
        throw new Error(`Could not find a Jules source matching '${repoName}'. Please check your Jules configuration.`);
      }

      // 2. Create Session
      await createSession(julesApiKey, newPrompt, sourceId, newBranch, newTitle);
      
      // 3. Refresh
      setIsCreateOpen(false);
      setNewPrompt('');
      setNewTitle('');
      setNewBranch('leader');
      await loadSessions();
    } catch (e: any) {
      alert(`Failed to create session: ${e.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!activeSession || !messageInput.trim()) return;
    setIsSending(true);
    try {
      // The API uses the full resource name for operations
      const name = (activeSession.name as string).split('/').pop() || activeSession.name;
      await sendMessage(julesApiKey, name, messageInput);
      setMessageInput('');
      await loadSessions(); // Refresh state
      alert("Message sent to session.");
    } catch (e: any) {
      alert(`Failed to send message: ${e.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async (name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this session?")) return;
    setDeletingSessionName(name);
    try {
      // Ensure name is treated as string. Fallback to name if pop() is undefined.
      const shortName = (name as string).split('/').pop() || (name as string);
      await deleteSession(julesApiKey, shortName);
      setSessions(prev => prev.filter(s => s.name !== name));
      if (activeSession?.name === name) setActiveSession(null);
    } catch (err: any) {
      alert("Failed to delete: " + err.message);
    } finally {
      setDeletingSessionName(null);
    }
  };

  // --- Bulk Cleanup Logic ---

  const handleSuggestCleanup = () => {
    // Select all sessions that are in the cleanupCandidates map
    const keys = new Set(cleanupCandidates.keys());
    setSelectedSessionNames(keys);
    setIsSelectionMode(true);
    if (keys.size === 0) {
      alert("No cleanup candidates found (failed or > 7 days old).");
    }
  };

  const toggleSelection = (name: string) => {
    const newSet = new Set(selectedSessionNames);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
      // Auto-preview logic: If selecting an item and it's not active, set it active so user can see it
      const session = sessions.find(s => s.name === name);
      if (session) setActiveSession(session);
    }
    setSelectedSessionNames(newSet);
  };

  const toggleSelectAll = () => {
    const allNames = sessions.map(s => s.name);
    if (selectedSessionNames.size === allNames.length) {
      setSelectedSessionNames(new Set());
    } else {
      setSelectedSessionNames(new Set(allNames));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Permanently delete ${selectedSessionNames.size} sessions?`)) return;
    setIsDeleting(true);
    
    const names = Array.from(selectedSessionNames);
    let successCount = 0;
    const errors: string[] = [];

    for (const name of names) {
      try {
        // Ensure name is treated as string. Fallback to name if pop() is undefined.
        const shortName = (name as string).split('/').pop() || (name as string);
        await deleteSession(julesApiKey, shortName);
        successCount++;
      } catch (e: any) {
        console.error(`Failed to delete ${name}`, e);
        errors.push(e.message || "Unknown error");
      }
    }

    // Refresh State
    setSessions(prev => prev.filter(s => !selectedSessionNames.has(s.name)));
    
    if (activeSession && selectedSessionNames.has(activeSession.name)) {
      setActiveSession(null);
      sessionStorage.removeItem('jules_last_active_session');
    }

    setSelectedSessionNames(new Set());
    setIsSelectionMode(false);
    setIsDeleting(false);

    // Provide Feedback
    if (errors.length > 0) {
        alert(`Partial success: Deleted ${successCount} sessions.\nFailed to delete ${errors.length} sessions.\n\nFirst error: ${errors[0]}`);
    } else {
        alert(`Successfully deleted ${successCount} sessions.`);
    }
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'RUNNING': 
      case 'IN_PROGRESS':
        return 'blue';
      case 'SUCCEEDED': 
      case 'COMPLETED':
        return 'green';
      case 'FAILED': 
      case 'CANCELLED':
      case 'TERMINATED':
        return 'red';
      case 'AWAITING_USER_FEEDBACK':
      case 'AWAITING_PLAN_APPROVAL':
        return 'yellow';
      default: return 'slate';
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'RUNNING': 
      case 'IN_PROGRESS':
        return <Play className="w-3 h-3 animate-pulse" />;
      case 'SUCCEEDED': 
      case 'COMPLETED':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'FAILED': 
      case 'CANCELLED':
      case 'TERMINATED':
        return <XCircle className="w-3 h-3" />;
      case 'AWAITING_USER_FEEDBACK':
      case 'AWAITING_PLAN_APPROVAL':
        return <Clock className="w-3 h-3" />;
      default: return <PauseCircle className="w-3 h-3" />;
    }
  };

  const getShortName = (name: string) => name.split('/').pop()?.substring(0, 8) + '...';

  const getPrUrl = (session: JulesSession) => {
    return session.outputs?.find(o => o.pullRequest)?.pullRequest?.url;
  };

  const renderLinkedText = (text: string) => {
    const elements: React.ReactNode[] = [];
    const regex = /(?:(PR|Issue)\s?)?#(\d+)/gi;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            elements.push(text.substring(lastIndex, match.index));
        }

        const fullText = match[0];
        const typeStr = match[1] ? match[1].toLowerCase() : 'issue'; 
        const linkType = typeStr === 'pr' ? 'pull' : 'issues';
        const number = match[2];
        
        elements.push(
            <a
                key={match.index}
                href={`https://github.com/${repoName}/${linkType}/${number}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-400 hover:text-blue-300 hover:underline z-10 relative font-mono"
            >
                {fullText}
            </a>
        );

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        elements.push(text.substring(lastIndex));
    }

    return elements.length > 0 ? <>{elements}</> : text;
  };

  // --- Render Session Item ---
  const renderSessionItem = (session: JulesSession) => {
    const prUrl = getPrUrl(session);
    const baseBranch = session.sourceContext?.githubRepoContext?.startingBranch || 'main';
    const isActive = activeSession?.name === session.name;
    const isSelected = selectedSessionNames.has(session.name);
    const isBeingDeleted = deletingSessionName === session.name;
    
    // Check if recommended for cleanup
    const cleanupReason = cleanupCandidates.get(session.name);

    return (
      <div 
        key={session.name}
        onClick={() => {
          if (isSelectionMode) toggleSelection(session.name);
          else setActiveSession(session);
        }}
        className={clsx(
          "p-3 rounded-lg border cursor-pointer transition-all flex flex-col group relative",
          isSelectionMode && isSelected 
             ? "bg-slate-800 border-primary/50 ring-1 ring-primary/20"
             : isActive 
                ? "bg-slate-800 border-purple-500/50 ring-1 ring-purple-500/20 shadow-lg" 
                : "bg-slate-900/40 border-slate-800 hover:bg-slate-800 hover:border-slate-700",
          isBeingDeleted && "opacity-50 pointer-events-none"
        )}
      >
        {/* Selection Checkbox */}
        {isSelectionMode && (
          <div className="absolute top-3 left-3 z-10">
             <input 
               type="checkbox" 
               checked={isSelected}
               onChange={() => toggleSelection(session.name)}
               className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-primary focus:ring-offset-0 focus:ring-0 cursor-pointer"
             />
          </div>
        )}

        {/* Header */}
        <div className={clsx("flex justify-between items-start mb-1.5", isSelectionMode && "pl-6")}>
          <h4 className={clsx("font-medium truncate pr-2 flex-1 text-sm", isActive ? "text-white" : "text-slate-300")} title={session.title || "Untitled"}>
            {renderLinkedText(session.title || "Untitled Session")}
          </h4>
          <Badge variant={getStatusColor(session.state) as any} className="text-[10px] py-0 px-1.5 h-5">
            {getStatusIcon(session.state)}
            <span className="ml-1 capitalize">{(session.state || '').toLowerCase().replace(/_/g, ' ')}</span>
          </Badge>
        </div>

        {/* Branch */}
        <div className={clsx("flex items-center gap-2 text-[11px] text-slate-500 mb-2", isSelectionMode && "pl-6")}>
           <GitBranch className="w-3 h-3" />
           <span className="font-mono truncate max-w-[150px]">{baseBranch}</span>
        </div>
        
        {/* Cleanup Recommendation Badge */}
        {isSelectionMode && cleanupReason && (
          <div className={clsx("text-[10px] text-red-400 bg-red-900/10 px-2 py-0.5 mb-2 rounded border border-red-900/20 inline-block self-start", isSelectionMode && "ml-6")}>
             Recommended: {cleanupReason}
          </div>
        )}

        {/* Footer */}
        <div className={clsx("flex justify-between items-center mt-auto pt-2 border-t border-slate-700/30", isSelectionMode && "pl-6")}>
           <span className="text-[10px] text-slate-600 font-mono">{getShortName(session.name)}</span>
           
           <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
             {prUrl && (
               <a 
                 href={prUrl} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 onClick={(e) => e.stopPropagation()}
                 className="flex items-center gap-1 text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800/50 hover:bg-green-900/50"
                 title="View Generated PR"
               >
                 <GitPullRequest className="w-3 h-3" />
               </a>
             )}
             {!isSelectionMode && (
               <button 
                 onClick={(e) => handleDelete(session.name, e)}
                 disabled={isBeingDeleted}
                 className="p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 disabled:opacity-50"
               >
                 {isBeingDeleted ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
               </button>
             )}
           </div>
        </div>
      </div>
    );
  };

  if (!julesApiKey) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <TerminalSquare className="w-16 h-16 mx-auto text-slate-600 mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Jules API Key Required</h2>
        <p className="text-slate-400 mb-6">Please configure your Jules API Key in settings to access sessions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
           <h2 className="text-2xl font-bold text-white flex items-center gap-2">
             <TerminalSquare className="text-purple-400 w-8 h-8" />
             Jules Sessions
           </h2>
           <p className="text-slate-400">Manage autonomous coding sessions.</p>
        </div>
        <div className="flex gap-3">
          {/* Cleanup Toggle */}
          {!isSelectionMode ? (
            <Button variant="ghost" onClick={handleSuggestCleanup} icon={Eraser}>
              Cleanup
              {cleanupCandidates.size > 0 && <span className="ml-1 bg-red-500/20 text-red-400 px-1.5 rounded-full text-[10px]">{cleanupCandidates.size}</span>}
            </Button>
          ) : (
            <>
               <Button variant="ghost" onClick={() => { setIsSelectionMode(false); setSelectedSessionNames(new Set()); }}>Cancel</Button>
               <Button variant="danger" onClick={handleBulkDelete} disabled={selectedSessionNames.size === 0 || isDeleting} icon={Trash2}>
                 Delete ({selectedSessionNames.size})
               </Button>
            </>
          )}

          <Button variant="secondary" onClick={loadSessions} isLoading={loading} icon={RefreshCw}>Refresh</Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} icon={Plus}>New Session</Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-200 p-4 rounded-lg mb-6 shrink-0 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex gap-6 flex-1 min-h-0">
        
        {/* LEFT: Session List & Controls */}
        <div className="w-[400px] bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden shrink-0">
           {/* Sidebar Controls */}
           <div className="p-3 border-b border-slate-700 bg-slate-800/50 flex flex-col gap-3">
             {/* Bulk Action Header (if selecting) */}
             {isSelectionMode && (
               <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded border border-slate-700 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-2">
                     <CheckSquare className="w-4 h-4 text-primary" />
                     <span className="text-xs font-bold text-white uppercase tracking-wider">Cleanup Mode</span>
                  </div>
                  <button onClick={toggleSelectAll} className="text-xs text-blue-400 hover:text-white underline">
                    {selectedSessionNames.size === sessions.length ? 'Deselect All' : 'Select All'}
                  </button>
               </div>
             )}

             {/* Sort Toggles */}
             <div className="flex rounded-lg bg-slate-900/50 p-1 border border-slate-700">
               <button 
                 onClick={() => setSortMode('recent')}
                 className={clsx("flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded transition-colors", sortMode === 'recent' ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white")}
               >
                 <Clock className="w-3 h-3" /> Recent
               </button>
               <button 
                 onClick={() => setSortMode('grouped')}
                 className={clsx("flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded transition-colors", sortMode === 'grouped' ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white")}
               >
                 <Layers className="w-3 h-3" /> Grouped
               </button>
             </div>

             {/* Status Filter Chips */}
             <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
               {[
                 { id: 'all', label: 'All' },
                 { id: 'active', label: 'Active' },
                 { id: 'completed', label: 'Done' },
                 { id: 'failed', label: 'Failed' },
               ].map(f => (
                 <button
                   key={f.id}
                   onClick={() => setFilterStatus(f.id as FilterStatus)}
                   className={clsx(
                     "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition-colors whitespace-nowrap",
                     filterStatus === f.id 
                       ? "bg-primary/20 text-primary border-primary/30" 
                       : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600"
                   )}
                 >
                   {f.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Session List */}
           <div className="overflow-y-auto flex-1 p-2 space-y-2 bg-surface">
             {processedSessions.type === 'list' ? (
               // Flat List
               <>
                 {(processedSessions as { items: JulesSession[] }).items.length === 0 && !loading && (
                   <div className="text-center py-10 text-slate-500 text-sm">No sessions found.</div>
                 )}
                 {(processedSessions as { items: JulesSession[] }).items.map((session) => renderSessionItem(session))}
               </>
             ) : (
               // Grouped List
               <>
                  {Object.entries((processedSessions as { groups: Record<string, JulesSession[]> }).groups).map(([group, groupSessions]) => (
                    <div key={group} className="mb-4">
                      <div className="px-2 py-1.5 text-xs font-bold text-slate-500 uppercase flex items-center gap-2 sticky top-0 bg-surface z-10">
                        <Layers className="w-3 h-3" /> {group} <span className="text-[10px] bg-slate-800 px-1.5 rounded-full">{groupSessions.length}</span>
                      </div>
                      <div className="space-y-2 pl-2 border-l border-slate-800 ml-2">
                        {groupSessions.map(session => renderSessionItem(session))}
                      </div>
                    </div>
                  ))}
                  {(processedSessions as { others: JulesSession[] }).others.length > 0 && (
                    <div className="mb-4">
                       <div className="px-2 py-1.5 text-xs font-bold text-slate-500 uppercase sticky top-0 bg-surface z-10">Ungrouped</div>
                       <div className="space-y-2 pl-2 border-l border-slate-800 ml-2">
                         {(processedSessions as { others: JulesSession[] }).others.map(session => renderSessionItem(session))}
                       </div>
                    </div>
                  )}
               </>
             )}
           </div>
        </div>

        {/* RIGHT: Conversation / Details */}
        <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative">
          {activeSession ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-start shrink-0 z-10">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                    {renderLinkedText(activeSession.title || "Untitled Session")}
                    <Badge variant={getStatusColor(activeSession.state) as any} className="capitalize">{(activeSession.state || '').toLowerCase().replace(/_/g, ' ')}</Badge>
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
                     <span title="Session ID">{activeSession.name.split('/').pop()}</span>
                     <span className="text-slate-600">|</span>
                     <span className="flex items-center gap-1"><GitBranch className="w-3 h-3"/> {activeSession.sourceContext?.githubRepoContext?.startingBranch || 'N/A'}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <a 
                        href={`https://jules.google.com/session/${activeSession.name.split('/').pop()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 text-slate-300 border border-slate-600/50 rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
                    >
                        <ExternalLink className="w-4 h-4" /> Open in Jules
                    </a>
                    {getPrUrl(activeSession) && (
                    <a 
                        href={getPrUrl(activeSession)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600/20 text-green-400 border border-green-600/30 rounded-lg hover:bg-green-600/30 transition-colors text-sm font-medium"
                    >
                        <GitPullRequest className="w-4 h-4" /> View PR
                    </a>
                    )}
                </div>
              </div>

              {/* Chat Timeline */}
              <div className="flex-1 p-6 overflow-y-auto bg-[#0B1120]">
                 <div className="max-w-3xl mx-auto space-y-6">
                    
                    {/* 1. Initial Prompt (User) */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                         <MessageSquare className="w-4 h-4 text-slate-300" />
                       </div>
                       <div className="space-y-1 max-w-[80%]">
                          <div className="text-xs text-slate-500 font-bold uppercase">You</div>
                          <div className="bg-slate-800 text-slate-200 p-3 rounded-tr-xl rounded-b-xl border border-slate-700 shadow-sm whitespace-pre-wrap text-sm">
                             {activeSession.title}
                          </div>
                          <div className="text-[10px] text-slate-600 pl-1">{new Date(activeSession.createTime).toLocaleTimeString()}</div>
                       </div>
                    </div>

                    {/* 2. Timeline Outputs */}
                    {((activeSession.outputs as any[]) || []).map((output: any, idx: number) => {
                       // PR Output
                       if (output.pullRequest) {
                         return (
                           <div key={idx} className="flex gap-4 justify-center py-4">
                              <div className="bg-slate-900/50 border border-green-500/30 p-4 rounded-xl flex items-center gap-4 max-w-md w-full shadow-lg shadow-green-900/10">
                                 <div className="bg-green-500/10 p-3 rounded-full">
                                    <GitPullRequest className="w-6 h-6 text-green-400" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <h4 className="text-green-400 font-bold text-sm">Pull Request Created</h4>
                                    <a href={output.pullRequest.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-white underline truncate block mt-1">
                                      {output.pullRequest.url}
                                    </a>
                                 </div>
                                 <a href={output.pullRequest.url} target="_blank" rel="noopener noreferrer" className="bg-green-600 hover:bg-green-500 text-white p-2 rounded-lg transition-colors">
                                    <ExternalLink className="w-4 h-4" />
                                 </a>
                              </div>
                           </div>
                         );
                       }
                       
                       return null;
                    })}

                    {/* 3. Status Messages */}
                    {['RUNNING', 'IN_PROGRESS', 'PENDING'].includes(activeSession.state) && (
                       <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 animate-pulse">
                            <TerminalSquare className="w-4 h-4 text-purple-400" />
                          </div>
                          <div className="space-y-1">
                             <div className="text-xs text-purple-400 font-bold uppercase">Jules</div>
                             <div className="text-slate-400 text-sm italic">Working on task...</div>
                          </div>
                       </div>
                    )}

                    {['AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'].includes(activeSession.state) && (
                       <div className="flex gap-4 justify-center py-4">
                          <div className="bg-amber-900/20 border border-amber-800/50 p-4 rounded-xl max-w-md text-center">
                             <Clock className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                             <h4 className="text-amber-400 font-bold mb-1">Waiting for You</h4>
                             <p className="text-sm text-amber-200/80">Jules is waiting for your feedback or plan approval.</p>
                          </div>
                       </div>
                    )}
                    
                    {['FAILED', 'CANCELLED', 'TERMINATED'].includes(activeSession.state) && (
                       <div className="flex gap-4 justify-center py-4">
                          <div className="bg-red-900/20 border border-red-800 p-4 rounded-xl max-w-md text-center">
                             <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                             <h4 className="text-red-400 font-bold mb-1">Session {activeSession.state}</h4>
                             {activeSession.error && <p className="text-sm text-red-200">{activeSession.error.message}</p>}
                          </div>
                       </div>
                    )}

                    {['SUCCEEDED', 'COMPLETED'].includes(activeSession.state) && !getPrUrl(activeSession) && (
                       <div className="flex gap-4 justify-center py-4">
                          <div className="bg-green-900/20 border border-green-800 p-3 rounded-lg flex items-center gap-2">
                             <CheckCircle2 className="w-5 h-5 text-green-400" />
                             <span className="text-green-400 text-sm font-medium">Session Completed Successfully</span>
                          </div>
                       </div>
                    )}
                 </div>
              </div>

              {/* Chat Input */}
              {['RUNNING', 'IN_PROGRESS', 'AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'].includes(activeSession.state) && (
                <div className="p-4 border-t border-slate-700 bg-slate-800/80 backdrop-blur-sm sticky bottom-0 z-20">
                  <div className="max-w-3xl mx-auto flex gap-2">
                    <input 
                      type="text" 
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder="Give feedback or new instructions..."
                      className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-primary focus:outline-none shadow-inner"
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    />
                    <Button variant="primary" onClick={handleSendMessage} disabled={!messageInput.trim() || isSending} isLoading={isSending} icon={Send} className="px-6">Send</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-900/20">
               <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6">
                 <TerminalSquare className="w-12 h-12 text-slate-600" />
               </div>
               <h3 className="text-xl font-medium text-slate-300 mb-2">No Session Selected</h3>
               <p className="max-w-sm text-center text-sm">Select an active session from the sidebar to view its timeline, or start a new autonomous coding session.</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 scale-100">
             <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
               <Plus className="w-5 h-5 text-primary" /> Start New Session
             </h3>
             
             <div className="space-y-4">
                <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Task Title</label>
                   <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="e.g. Fix Login Bug" autoFocus />
                </div>
                <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Starting Branch</label>
                   <input type="text" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono text-sm" placeholder="leader" />
                </div>
                <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Instructions</label>
                   <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none" placeholder="Describe the task in detail..." />
                </div>
             </div>

             <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
                <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleCreate} disabled={!newPrompt || isCreating} isLoading={isCreating} icon={Play}>Start Session</Button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JulesSessions;
