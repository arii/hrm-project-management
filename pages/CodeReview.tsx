
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  fetchPullRequests,
  fetchEnrichedPullRequests,
  fetchPrDiff, 
  addComment, 
  addLabels, 
  removeLabel, 
  createIssue, 
  enrichSinglePr,
  fetchComments, 
  fetchReviewComments
} from '../services/githubService';
import { generateCodeReview, extractIssuesFromComments } from '../services/geminiService';
import { createSession, findSourceForRepo } from '../services/julesService';
import { storage, StorageKeys } from '../services/storageService';
import { EnrichedPullRequest, GithubPullRequest, CodeReviewResult, ProposedIssue, ModelTier } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Eye, Loader2, RefreshCw, Send, FileSearch, Plus, Check, TerminalSquare, RotateCcw, Bot, AlertTriangle, ExternalLink, FileCode, CheckCircle2, ShieldCheck, XCircle, Clock, ChevronDown, ChevronUp, BrainCircuit } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import CredentialsRequired from '../components/ui/CredentialsRequired';
import WorkerSelectorModal from '../components/ui/WorkerSelectorModal';
import { useIssueDispatch } from '../hooks/useIssueDispatch';
import { useJulesSessions } from '../hooks/useJulesSessions';

interface CodeReviewProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type ReviewStatus = 'idle' | 'analyzing' | 'posting' | 'completed' | 'error';
type ExtractedIssueUI = ProposedIssue & { _id: string; isCreated?: boolean; isDispatched?: boolean };

const MANAGED_LABELS = new Set(['small', 'medium', 'large', 'xl', 'needs-improvement', 'ready-for-approval']);

const CodeReview: React.FC<CodeReviewProps> = ({ repoName, token, julesApiKey }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [prs, setPrs] = useState<GithubPullRequest[]>([]);
  const [enrichedMap, setEnrichedMap] = useState<Record<number, EnrichedPullRequest>>({});
  const [loading, setLoading] = useState(false);
  const [isRefreshingPr, setIsRefreshingPr] = useState(false);
  const [selectedPr, setSelectedPr] = useState<EnrichedPullRequest | null>(null);
  
  const [selectedPrIds, setSelectedPrIds] = useState<Set<number>>(new Set());
  const [isBulkAuditing, setIsBulkAuditing] = useState(false);
  
  const currentFetchPrRef = useRef<number | null>(null);
  
  const [reviews, setReviews] = useState<Record<number, CodeReviewResult>>({});
  const [statuses, setStatuses] = useState<Record<number, ReviewStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [listProgress, setListProgress] = useState<{ total: number; current: number }>({ total: 0, current: 0 });
  const [bulkProgress, setBulkProgress] = useState<{ total: number; current: number }>({ total: 0, current: 0 });
  const [manualTier, setManualTier] = useState<ModelTier | null>(null);
  
  const [actionError, setActionError] = useState<string | null>(null);

  const [extractedIssues, setExtractedIssues] = useState<ExtractedIssueUI[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [creatingIssueId, setCreatingIssueId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<ExtractedIssueUI[]>([]);
  const [reviewedShas, setReviewedShas] = useState<Record<number, string>>({});

  const { isDispatching, dispatchIssue, dispatchErrors } = useIssueDispatch(repoName, token);
  const {
    allSessions,
    suggestedSessions,
    julesReportStatus,
    onReportToJules
  } = useJulesSessions(julesApiKey, repoName);

  const [workerModal, setWorkerModal] = useState<{ isOpen: boolean; finding: any | null }>({ isOpen: false, finding: null });

  const loadPrList = useCallback(async (skipCache = false) => {
    setLoading(true);
    try {
      // 1. Fetch BASIC PR list immediately
      const list = await fetchPullRequests(repoName, token, 'open', skipCache);
      const initialPrs = list.map(pr => ({
        ...pr,
        testStatus: 'unknown',
        isApproved: false,
        isBig: false,
        isReadyToMerge: false,
        isLeaderBranch: false
      } as EnrichedPullRequest));
      setPrs(initialPrs);
      
      // Auto-detect already reviewed PRs and populate from storage
      const newStatuses: Record<number, ReviewStatus> = {};
      const newReviews: Record<number, CodeReviewResult> = {};
      
      initialPrs.forEach(pr => {
        const existing = storage.getPrReview(repoName, pr.number);
        if (existing) {
          newStatuses[pr.number] = 'completed';
          newReviews[pr.number] = existing;
        }
      });
      
      if (Object.keys(newStatuses).length > 0) {
        setStatuses(prev => ({ ...prev, ...newStatuses }));
        setReviews(prev => ({ ...prev, ...newReviews }));
      }
      
      // Stop skeleton loader immediately
      setLoading(false);

      // 2. Background Enrichment
      const toEnrich = initialPrs.slice(0, 20);
      setListProgress({ total: toEnrich.length, current: 0 });
      const chunkSize = 2; // Reduced from 4 for stability
      let completedCount = 0;
      
      for (let i = 0; i < toEnrich.length; i += chunkSize) {
        const chunk = toEnrich.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (pr) => {
          try {
            const enriched = await enrichSinglePr(repoName, pr, token, false);
            setEnrichedMap(prev => ({ ...prev, [pr.number]: enriched }));
            setPrs(prev => prev.map(p => p.number === pr.number ? enriched : p));
          } catch (e) {
            console.warn(`[CodeReview] Failed to enrich PR #${pr.number}`, e);
          } finally {
            completedCount++;
            setListProgress({ total: toEnrich.length, current: completedCount });
          }
        }));
      }
      
      return initialPrs;
    } catch (e: any) { 
      console.error(e); 
      setLoading(false); 
    } finally {
      setListProgress({ total: 0, current: 0 });
    }
  }, [repoName, token]);

  useEffect(() => {
    if (repoName && token) {
      loadPrList().then((list) => {
        const storedState = storage.get<{selectedPrNumber?: number}>(StorageKeys.CODE_REVIEW_STATE);
        const prNumber = location.state?.selectedPrNumber || storedState?.selectedPrNumber;
        if (prNumber && list) {
           const match = list.find(p => p.number === prNumber);
           if (match) handleSelectPr(match);
        }
      });
      const stored = storage.getReviewedShas(repoName);
      setReviewedShas(stored);
    } else {
      setLoading(false);
      setActionError("GitHub Token or Repository Name is missing. Please check your settings.");
    }
  }, [repoName, token, loadPrList]);

  // Persist selected PR to storage
  useEffect(() => {
    if (selectedPr) {
      storage.setCached(StorageKeys.CODE_REVIEW_STATE, { selectedPrNumber: selectedPr.number });
    }
  }, [selectedPr]);

  useEffect(() => {
    if (selectedPr && reviews[selectedPr.number]) {
      const review = reviews[selectedPr.number];
      // Only populate if aiSuggestions are empty to avoid overwriting user interactions
      if (review.suggestedIssues && aiSuggestions.length === 0) {
        setAiSuggestions(review.suggestedIssues.map(i => ({ 
          ...i, 
          // Preserve existing IDs or generate new ones if missing
          _id: (i as any)._id || Math.random().toString(36).substr(2, 9) 
        })));
      }
    }
  }, [selectedPr, reviews]);

  const updateReviewedSha = (prNumber: number, sha: string) => {
    setReviewedShas(prev => {
      const next = { ...prev, [prNumber]: sha };
      storage.saveReviewedShas(repoName, next);
      return next;
    });
  };

  const handleSelectPr = async (pr: GithubPullRequest) => {
    if (currentFetchPrRef.current === pr.number) return;
    currentFetchPrRef.current = pr.number;
    
    // Check if we already have enriched data
    const existingEnriched = enrichedMap[pr.number];
    
    // Immediate selection feedback
    const fastEnriched: EnrichedPullRequest = existingEnriched || {
      ...pr,
      testStatus: 'pending',
      isApproved: false,
      isBig: false,
      isReadyToMerge: false,
      isLeaderBranch: false
    };
    setSelectedPr(fastEnriched);
    
    // Clear temporary UI state
    setLoadingMessage("");
    setExtractedIssues([]);
    setAiSuggestions([]);
    setActionError(null);

    // Check storage for existing reviews
    let review = storage.getPrReview(repoName, pr.number);
    if (review) {
      setReviews(prev => ({ ...prev, [pr.number]: review }));
      if (review.suggestedIssues) {
        setAiSuggestions(review.suggestedIssues.map((i: any) => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
      }
    }

    // Only refresh if we don't have check results or if it's explicitly requested
    // For now, we'll always do a background refresh but use cached data if available
    setIsRefreshingPr(true);
    try {
      // Tier 2: includeReviews = true for the detail view
      const full = await enrichSinglePr(repoName, pr, token, true);
      
      // Prevent race condition: only update if this is still the active PR
      if (currentFetchPrRef.current === pr.number) {
        setEnrichedMap(prev => ({ ...prev, [pr.number]: full }));
        setSelectedPr(full);
      }
    } catch (e: any) {
      console.error("Enrichment failed", e);
      if (currentFetchPrRef.current === pr.number) {
        setActionError(e.message || "Failed to fetch full technical metadata. Results may be incomplete.");
      }
    } finally {
      if (currentFetchPrRef.current === pr.number) {
        setIsRefreshingPr(false);
      }
    }
  };

  const runFullCodeReview = async (pr: EnrichedPullRequest, isBulk = false, options: { modelTier?: ModelTier, lowThinking?: boolean } = {}) => {
    if (!token) return;
    setStatuses(prev => ({ ...prev, [pr.number]: 'analyzing' }));
    setErrors(prev => { const next = { ...prev }; delete next[pr.number]; return next; });
    
    // Explicit model tier logic: User selection > Storage Tier > Flash (if Pro fails)
    const tier = options.modelTier || manualTier || storage.getModelTier();

    const setMsg = (msg: string) => {
      if (!isBulk) setLoadingMessage(msg);
    };

    try {
      setMsg("Retrieving code diff...");
      const diff = await fetchPrDiff(repoName, pr.number, token);
      if (!diff) throw new Error("Could not retrieve diff.");
      
      setMsg(tier === ModelTier.PRO ? "AI Performing Deep Architectural Reasoning..." : "AI Analyzing patterns...");
      const review = await generateCodeReview(pr, diff, { ...options, modelTier: tier });
      storage.savePrReview(repoName, pr.number, review);
      setReviews(prev => ({ ...prev, [pr.number]: review }));
      
      if (pr.number === selectedPr?.number && review.suggestedIssues) {
        setAiSuggestions(review.suggestedIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
      }

      setStatuses(prev => ({ ...prev, [pr.number]: 'posting' }));
      setMsg("Publishing audit to GitHub...");
      
      const commentBody = `### 🤖 AI Technical Audit\n\n${review.reviewComment}\n\n*Review automatically published via RepoAuditor.*`;
      await addComment(repoName, token, pr.number, commentBody);

      if (review.labels && review.labels.length > 0) {
        setMsg("Applying context labels...");
        const labelsToRemove = pr.labels.map(l => l.name).filter(name => MANAGED_LABELS.has(name));
        for (const label of labelsToRemove) { await removeLabel(repoName, token, pr.number, label).catch(() => {}); }
        await addLabels(repoName, token, pr.number, review.labels);
      }

      updateReviewedSha(pr.number, pr.head.sha);
      setStatuses(prev => ({ ...prev, [pr.number]: 'completed' }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [pr.number]: e.message || 'Process failed' }));
      setStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
    } finally { 
      if (!isBulk) setLoadingMessage(""); 
    }
  };

  const handleBulkAudit = async () => {
    if (selectedPrIds.size === 0) return;
    setIsBulkAuditing(true);
    const ids = Array.from(selectedPrIds);
    setBulkProgress({ total: ids.length, current: 0 });
    
    // Concurrency control to avoid rate limits
    const CONCURRENCY_LIMIT = 3; // Optimized for performance vs rate limits
    const chunks = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY_LIMIT) {
      chunks.push(ids.slice(i, i + CONCURRENCY_LIMIT));
    }

    try {
      let completedCount = 0;
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (id) => {
          const pr = prs.find(p => p.number === id);
          if (!pr) return;
          
          const enriched = enrichedMap[id] || pr;
          
          // Bulk audits default to LITE if not in debug/pro mode to save costs
          const bulkTier = storage.getModelTier() === ModelTier.PRO ? ModelTier.FLASH : ModelTier.LITE;

          // Skip if already reviewed at this SHA
          if (reviewedShas[id] === enriched.head.sha && statuses[id] === 'completed') {
            completedCount++;
            setBulkProgress({ total: ids.length, current: completedCount });
            return;
          }
          
          let fullPr = enrichedMap[id];
          if (!fullPr || !fullPr.checkResults) {
            try {
              fullPr = await enrichSinglePr(repoName, pr, token, true);
              setEnrichedMap(prev => ({ ...prev, [id]: fullPr }));
            } catch (e) {
              setErrors(prev => ({ ...prev, [id]: "Enrichment failed" }));
              setStatuses(prev => ({ ...prev, [id]: 'error' }));
              completedCount++;
              setBulkProgress({ total: ids.length, current: completedCount });
              return;
            }
          }
          
          // Using cost-optimized tier for bulk audits
          await runFullCodeReview(fullPr as EnrichedPullRequest, true, { modelTier: bulkTier, lowThinking: true });
          completedCount++;
          setBulkProgress({ total: ids.length, current: completedCount });
        }));
      }
    } catch (e: any) {
      setActionError(`Bulk audit encountered errors: ${e.message}`);
    } finally {
      setIsBulkAuditing(false);
      setSelectedPrIds(new Set());
      setBulkProgress({ total: 0, current: 0 });
    }
  };

  const toggleSelectPr = (e: React.ChangeEvent<HTMLInputElement>, prNumber: number) => {
    e.stopPropagation();
    setSelectedPrIds(prev => {
      const next = new Set(prev);
      if (next.has(prNumber)) next.delete(prNumber);
      else next.add(prNumber);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPrIds.size === prs.length) {
      setSelectedPrIds(new Set());
    } else {
      setSelectedPrIds(new Set(prs.map(p => p.number)));
    }
  };

  const handleScanComments = async () => {
    if (!selectedPr) return;
    setIsExtracting(true);
    setLoadingMessage("Scanning...");
    try {
      const [issueComments, reviewComments] = await Promise.all([
        fetchComments(repoName, selectedPr.number, token),
        fetchReviewComments(repoName, selectedPr.number, token)
      ]);
      const allComments = [...issueComments, ...reviewComments].map(c => ({ id: c.id, user: c.user.login, body: c.body, url: c.html_url }));
      if (allComments.length === 0) { setActionError("No relevant comments found."); return; }
      const proposed = await extractIssuesFromComments(allComments);
      setExtractedIssues(proposed.map(p => ({ ...p, _id: Math.random().toString(36).substr(2, 9) })));
    } catch (e: any) { 
      setActionError(`Scan failed: ${e.message}`); 
    } finally { 
      setIsExtracting(false); 
      setLoadingMessage(""); 
    }
  };

  const handleCreateIssue = async (issue: ExtractedIssueUI, source: 'ai' | 'human') => {
    if (!token) return;
    setCreatingIssueId(issue._id);
    try {
      const success = await dispatchIssue(
        issue._id,
        issue.title,
        `${issue.body}\n\n---\n*Extracted from PR #${selectedPr?.number} via RepoAuditor.*`,
        [...issue.labels, 'follow-up']
      );
      
      if (success) {
        if (source === 'human') setExtractedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
        else setAiSuggestions(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
      }
    } finally { 
      setCreatingIssueId(null); 
    }
  };

  const handleDispatchTaskToJules = (issue: ExtractedIssueUI) => {
    setWorkerModal({ isOpen: true, finding: issue });
  };

  const currentStatus = selectedPr ? statuses[selectedPr.number] || 'idle' : 'idle';
  const hasExistingReview = selectedPr ? reviewedShas[selectedPr.number] === selectedPr.head.sha : false;

  if (!repoName || !token) {
    return <CredentialsRequired />;
  }

  return (
    <div className="max-w-[1600px] mx-auto h-auto lg:h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
           <h2 className="text-xl lg:text-2xl font-bold text-white mb-2 flex items-center gap-2">
             <Eye className="text-blue-400 w-6 h-6 lg:w-8 lg:h-8" /> Principal AI Review
           </h2>
           <p className="text-sm text-slate-400">Comprehensive auditing and automated implementation roadmaps.</p>
        </div>
        {selectedPr && (
           <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
             <div className="flex gap-2 w-full md:w-auto">
               <Button 
                variant="secondary" 
                size="sm" 
                onClick={handleScanComments} 
                disabled={isExtracting} 
                isLoading={isExtracting} 
                icon={FileSearch}
                className="flex-1 md:flex-none"
               >
                 Scan
               </Button>
               {(currentStatus === 'idle' || currentStatus === 'completed' || currentStatus === 'error') && (
                  <div className="flex bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex-1 md:flex-none">
                    <Button 
                      variant="primary" 
                      size="sm" 
                      onClick={() => runFullCodeReview(selectedPr)} 
                      icon={Send} 
                      className="rounded-none border-none"
                    >
                      {hasExistingReview ? 'Refresh' : 'Run Audit'}
                    </Button>
                    <div className="border-l border-slate-700 flex items-center px-1 bg-slate-800">
                      <select 
                        value={manualTier || storage.getModelTier()} 
                        onChange={(e) => setManualTier(e.target.value as ModelTier)}
                        className="bg-transparent text-[10px] text-slate-300 font-bold focus:outline-none cursor-pointer px-1 uppercase tracking-tighter"
                      >
                        <option value={ModelTier.LITE}>Lite</option>
                        <option value={ModelTier.FLASH}>Flash</option>
                        <option value={ModelTier.PRO}>Pro (Deep)</option>
                      </select>
                    </div>
                  </div>
               )}
             </div>
             {actionError && (
               <div className="p-2 rounded border bg-red-900/20 border-red-800/50 text-red-300 flex items-center gap-3 animate-in fade-in max-w-sm text-[10px]">
                 <AlertTriangle className="w-3 h-3 shrink-0" />
                 <span className="truncate">{actionError}</span>
               </div>
             )}
           </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        {/* SIDEBAR - PR LIST */}
        <div className="w-full lg:w-[400px] bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden shrink-0">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
             <div className="flex items-center gap-3">
               <input 
                 type="checkbox" 
                 className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500/20 cursor-pointer"
                 checked={prs.length > 0 && selectedPrIds.size === prs.length}
                 onChange={toggleSelectAll}
               />
               <div className="flex flex-col">
                 <span className="font-semibold text-white">Active Pull Requests</span>
                 {listProgress.total > 0 && (
                   <span className="text-[9px] text-blue-400 animate-pulse font-mono flex items-center gap-1">
                     <Loader2 className="w-2 h-2 animate-spin" /> 
                     Finding check statuses ({listProgress.current}/{listProgress.total})...
                   </span>
                 )}
               </div>
             </div>
             <div className="flex items-center gap-2">
               {selectedPrIds.size > 0 && (
                 <Button 
                   variant="primary" 
                   size="xs" 
                   onClick={handleBulkAudit} 
                   isLoading={isBulkAuditing}
                   className="h-7 px-2 text-[10px]"
                 >
                   {isBulkAuditing ? 'Auditing...' : `Audit ${selectedPrIds.size}`}
                 </Button>
               )}
               <Button variant="ghost" size="sm" onClick={() => loadPrList(true)} isLoading={loading} icon={RefreshCw} className="h-8 w-8 p-0" />
             </div>
          </div>
          {isBulkAuditing && (
            <div className="px-4 py-2 bg-blue-900/20 border-b border-slate-700 text-[10px] text-blue-400 flex items-center justify-between animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Processing Batch ({bulkProgress.current}/{bulkProgress.total})</span>
              </div>
              <span className="font-mono">{bulkProgress.total > 0 ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0}%</span>
            </div>
          )}
          <div className="max-h-64 lg:max-h-none overflow-y-auto flex-1 p-2 space-y-2 custom-scrollbar">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 animate-pulse">
                  <div className="w-4 h-4 rounded bg-slate-800 ml-1" />
                  <div className="flex-1 space-y-2 ml-2">
                    <div className="h-4 bg-slate-800 rounded w-3/4" />
                    <div className="h-3 bg-slate-800 rounded w-1/4" />
                  </div>
                </div>
              ))
            ) : prs.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs italic">No active pull requests found.</div>
            ) : (
              prs.map(pr => {
                const enriched = enrichedMap[pr.number];
                const isSelected = selectedPrIds.has(pr.number);
                const status = statuses[pr.number] || 'idle';
                
                return (
                  <div 
                    key={pr.id}
                    className={clsx(
                      "group relative flex items-center gap-2 p-1 rounded-lg transition-all border",
                      selectedPr?.id === pr.id ? "bg-slate-800 border-blue-500/50" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"
                    )}
                  >
                    <div className="pl-2">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500/20 cursor-pointer"
                        checked={isSelected}
                        onChange={(e) => toggleSelectPr(e, pr.number)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <button 
                      onClick={() => handleSelectPr(pr)} 
                      className="flex-1 text-left p-2 rounded-lg flex flex-col"
                    >
                      <div className="flex justify-between items-start w-full">
                        <h4 className="font-medium text-sm line-clamp-1 pr-2 text-slate-300 group-hover:text-white">{pr.title}</h4>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {reviews[pr.number] && <Bot className="w-3.5 h-3.5 text-blue-400" />}
                          {status === 'completed' && <Badge variant="green" className="text-[8px]">Done</Badge>}
                          {(status === 'analyzing' || status === 'posting') && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                          {status === 'error' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500 font-mono">
                        #{pr.number}
                        {enriched ? (
                          <>
                            <span className="h-1 w-1 bg-slate-800 rounded-full" />
                            <span className={clsx(
                              enriched.testStatus === 'failed' ? "text-red-400 font-bold" : 
                              enriched.testStatus === 'passed' ? "text-green-400 font-bold" :
                              enriched.testStatus === 'pending' ? "text-yellow-400" : "text-slate-500"
                            )}>{enriched.testStatus}</span>
                          </>
                        ) : (
                          <span className="text-[9px] opacity-40">Loading...</span>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* WORKSPACE */}
        <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative min-h-[500px]">
          {isBulkAuditing && (
            <div className="absolute inset-0 z-50 bg-[#0B1120]/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
              <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl space-y-6">
                <div className="relative h-20 w-20 mx-auto">
                  <div className="absolute inset-0 rounded-full border-4 border-slate-700"></div>
                  <div 
                    className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"
                    style={{ animationDuration: '2s' }}
                  ></div>
                  <div className="absolute inset-0 flex items-center justify-center font-bold text-xl text-white">
                    {bulkProgress.total > 0 ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0}%
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-white">Bulk Audit in Progress</h3>
                  <p className="text-sm text-slate-400">
                    Processing <span className="text-blue-400 font-bold">#{bulkProgress.current + 1}</span> of <span className="text-white font-bold">{bulkProgress.total}</span> selected PRs
                  </p>
                  <div className="w-full bg-slate-900 rounded-full h-2 mt-4 overflow-hidden shadow-inner">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                      style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>

                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                   <p className="text-[10px] font-mono text-blue-400 flex items-center justify-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Batch Processing to optimize API quotas...
                   </p>
                </div>
              </div>
            </div>
          )}

          {!selectedPr ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8"><Eye className="w-16 h-16 mb-4 opacity-10" /><p className="font-medium text-center">Choose a Pull Request to deploy the AI auditor.</p></div>
          ) : (
            <>
              <div className="p-4 lg:p-6 border-b border-slate-700 bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                 <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2 truncate">
                       {selectedPr.title} 
                       <Button variant="ghost" size="sm" onClick={() => handleSelectPr(selectedPr)} isLoading={isRefreshingPr} icon={RefreshCw} className="h-6 w-6 p-0" />
                    </h3>
                    <div className="flex gap-3 text-[10px] text-slate-400 font-mono">
                      <span className="truncate max-w-[100px]">{selectedPr.head.ref}</span>
                      <span className="text-slate-600">→</span>
                      <span className="truncate max-w-[100px]">{selectedPr.base.ref}</span>
                    </div>
                 </div>
                 <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={selectedPr.testStatus === 'passed' ? 'green' : (selectedPr.testStatus === 'failed' ? 'red' : 'yellow')} className="text-[8px]">
                      {selectedPr.testStatus}
                    </Badge>
                    <a href={selectedPr.html_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-500 hover:text-blue-400 uppercase font-bold"><ExternalLink className="w-3 h-3" /></a>
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-[#0B1120] custom-scrollbar space-y-8">
                {isRefreshingPr && (
                  <div className="flex items-center gap-3 text-sm text-blue-400 font-mono animate-pulse bg-blue-900/10 p-3 rounded-lg border border-blue-500/20">
                     <Loader2 className="w-4 h-4 animate-spin" /> Fetching technical metadata (Checks & Statuses)...
                  </div>
                )}

                {selectedPr.checkResults && selectedPr.checkResults.length > 0 && (
                   <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 animate-in fade-in slide-in-from-top-1">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">Checks & Statuses</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                         {selectedPr.checkResults.map((check, idx) => (
                           <a key={idx} href={check.url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-950/50 border border-slate-800 rounded flex items-center justify-between group hover:border-slate-600 transition-all">
                              <span className="text-[10px] text-slate-300 truncate font-medium">{check.name}</span>
                              {check.conclusion === 'success' ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : 
                               (check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'action_required') ? <XCircle className="w-3 h-3 text-red-500" /> :
                               (check.conclusion === 'skipped' || check.conclusion === 'cancelled' || check.conclusion === 'neutral') ? <XCircle className="w-3 h-3 text-slate-500" /> :
                               <Clock className="w-3 h-3 text-yellow-500 animate-pulse" />}
                           </a>
                         ))}
                      </div>
                   </div>
                )}

                {/* Roadmap Section: Suggestions & Extracted Issues */}
                {(aiSuggestions.length > 0 || extractedIssues.length > 0) && (
                   <div className="space-y-6">
                      {aiSuggestions.length > 0 && (
                        <div className="bg-blue-900/10 border border-blue-500/20 rounded-2xl p-4 lg:p-6 animate-in fade-in">
                           <h4 className="text-blue-300 font-bold flex items-center gap-2 text-sm mb-4">
                             <Bot className="w-4 h-4" /> AI Audit Roadmap
                           </h4>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {aiSuggestions.map(issue => (
                                <div key={issue._id} className="bg-slate-900/60 rounded-xl p-4 border border-blue-500/20 hover:border-blue-500/40 transition-colors">
                                   <div className="flex justify-between items-start mb-2">
                                     <h5 className="text-slate-200 font-bold text-xs line-clamp-1">{issue.title}</h5>
                                     <Badge variant={issue.priority === 'High' ? 'red' : (issue.priority === 'Medium' ? 'yellow' : 'blue')} className="text-[8px] px-1 py-0 h-4">
                                       {issue.priority}
                                     </Badge>
                                   </div>
                                   <p className="text-[10px] text-slate-400 line-clamp-2 mb-3 h-8">{issue.reason}</p>
                                   <div className="flex gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="ghost" 
                                        onClick={() => handleCreateIssue(issue, 'ai')} 
                                        disabled={!!issue.isCreated || isDispatching(issue._id)} 
                                        isLoading={isDispatching(issue._id)}
                                        icon={issue.isCreated ? Check : Plus} 
                                        className="text-[10px] flex-1 py-1 h-7"
                                      >
                                       {issue.isCreated ? 'Created' : 'Issue'}
                                     </Button>
                                     {!issue.isCreated && (
                                       <Button size="sm" variant="ghost" onClick={() => handleDispatchTaskToJules(issue)} icon={TerminalSquare} className="text-[10px] flex-1 py-1 h-7 text-purple-400">
                                         AI Solve
                                       </Button>
                                     )}
                                   </div>
                                   {dispatchErrors[issue._id] && (
                                     <div className="mt-2 text-[10px] text-red-400 leading-tight bg-red-400/10 p-2 rounded-lg border border-red-500/20">
                                       {dispatchErrors[issue._id]}
                                     </div>
                                   )}
                                </div>
                              ))}
                           </div>
                        </div>
                      )}

                      {extractedIssues.length > 0 && (
                        <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-2xl p-4 lg:p-6 animate-in fade-in">
                           <h4 className="text-emerald-300 font-bold flex items-center gap-2 text-sm mb-4">
                             <FileSearch className="w-4 h-4" /> Issues Extracted from Comments
                           </h4>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {extractedIssues.map(issue => (
                                <div key={issue._id} className="bg-slate-900/60 rounded-xl p-4 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                                   <div className="flex justify-between items-start mb-2">
                                     <h5 className="text-slate-200 font-bold text-xs line-clamp-1">{issue.title}</h5>
                                     <Badge variant="green" className="text-[8px] px-1 py-0 h-4">
                                       Extracted
                                     </Badge>
                                   </div>
                                   <p className="text-[10px] text-slate-400 line-clamp-2 mb-3 h-8">{issue.reason}</p>
                                   <div className="flex gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="ghost" 
                                        onClick={() => handleCreateIssue(issue, 'human')} 
                                        disabled={!!issue.isCreated || isDispatching(issue._id)} 
                                        isLoading={isDispatching(issue._id)}
                                        icon={issue.isCreated ? Check : Plus} 
                                        className="text-[10px] flex-1 py-1 h-7"
                                      >
                                       {issue.isCreated ? 'Created' : 'Issue'}
                                     </Button>
                                     {!issue.isCreated && (
                                       <Button size="sm" variant="ghost" onClick={() => handleDispatchTaskToJules(issue)} icon={TerminalSquare} className="text-[10px] flex-1 py-1 h-7 text-purple-400">
                                         AI Solve
                                       </Button>
                                     )}
                                   </div>
                                   {dispatchErrors[issue._id] && (
                                     <div className="mt-2 text-[10px] text-red-400 leading-tight bg-red-400/10 p-2 rounded-lg border border-red-500/20">
                                       {dispatchErrors[issue._id]}
                                     </div>
                                   )}
                                </div>
                              ))}
                           </div>
                        </div>
                      )}
                   </div>
                )}

                {(currentStatus === 'analyzing' || currentStatus === 'posting') && (
                   <div className="flex flex-col items-center justify-center py-24 text-slate-400 relative">
                      <div className="absolute inset-0 bg-blue-500/5 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] animate-pulse" />
                      <div className="mb-8 relative">
                        <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl animate-pulse" />
                        <div className="w-20 h-20 rounded-full border-2 border-slate-700/50 flex items-center justify-center relative bg-slate-900 overflow-hidden">
                           <BrainCircuit className="w-10 h-10 text-blue-400 relative z-10 animate-pulse" />
                           <div className="absolute inset-x-0 bottom-0 bg-blue-500/10 transition-all duration-[5000ms] ease-linear" 
                                style={{ 
                                   height: loadingMessage.includes('diff') ? '25%' : 
                                           loadingMessage.includes('Analyze') ? '50%' :
                                           loadingMessage.includes('Reasoning') ? '75%' :
                                           loadingMessage.includes('GitHub') ? '95%' : '10%'
                                }} 
                           />
                        </div>
                      </div>
                      <div className="text-center space-y-4 max-w-sm relative z-10">
                        <h4 className="text-xl font-bold text-white tracking-tight">
                           {currentStatus === 'analyzing' ? 'Audit in Progress' : 'Publishing Audit'}
                        </h4>
                        <div className="flex items-center justify-center gap-3">
                           <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                           <p className="text-sm font-medium text-slate-300">{loadingMessage}</p>
                        </div>
                        
                        <div className="pt-4 flex justify-center gap-2">
                           {[0, 1, 2, 3].map(i => (
                              <div 
                                 key={i} 
                                 className={clsx(
                                    "h-1 w-8 rounded-full transition-all duration-500",
                                    (loadingMessage.includes('diff') && i === 0) ||
                                    (loadingMessage.includes('Analyze') && i <= 1) ||
                                    (loadingMessage.includes('Reasoning') && i <= 2) ||
                                    (loadingMessage.includes('GitHub') && i <= 3) 
                                       ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" 
                                       : "bg-slate-800"
                                 )}
                              />
                           ))}
                        </div>
                        <p className="text-[10px] text-slate-500 italic mt-6">
                           Analyzing complex architectural patterns. This typically takes 30-90 seconds.
                        </p>
                      </div>
                   </div>
                )}

                {reviews[selectedPr.number] && (currentStatus === 'completed' || currentStatus === 'idle') && (
                  <div className="space-y-4 animate-in fade-in duration-700">
                    <div className="flex items-center justify-between px-2">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Bot className="w-3 h-3 text-blue-400" /> Detailed Audit Report
                      </h4>
                      <span className="text-[10px] text-slate-600 font-mono">
                        Generated by Principal AI
                      </span>
                    </div>
                    <div className="bg-slate-900/80 border border-slate-700/50 p-6 lg:p-10 rounded-2xl shadow-2xl backdrop-blur-sm">
                       {reviews[selectedPr.number].recommendation && (
                         <div className={clsx(
                           "mb-8 p-4 rounded-xl border flex items-center justify-between animate-in slide-in-from-top-2 duration-500",
                           reviews[selectedPr.number].recommendation === 'Approved' ? "bg-green-500/10 border-green-500/30 text-green-400" :
                           reviews[selectedPr.number].recommendation === 'Approved with Minor Changes' ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                           "bg-red-500/10 border-red-500/30 text-red-400"
                         )}>
                           <div className="flex items-center gap-3">
                             {reviews[selectedPr.number].recommendation === 'Approved' ? <ShieldCheck className="w-6 h-6 shrink-0" /> : 
                              reviews[selectedPr.number].recommendation === 'Approved with Minor Changes' ? <AlertTriangle className="w-6 h-6 shrink-0" /> : 
                              <XCircle className="w-6 h-6 shrink-0" />}
                             <div>
                               <p className="text-[10px] uppercase font-bold opacity-60 leading-none mb-1">Audit Verdict</p>
                               <h5 className="font-black text-lg lg:text-xl uppercase tracking-tighter leading-none italic">{reviews[selectedPr.number].recommendation}</h5>
                             </div>
                           </div>
                           <Badge variant={
                             reviews[selectedPr.number].recommendation === 'Approved' ? 'green' : 
                             (reviews[selectedPr.number].recommendation === 'Approved with Minor Changes' ? 'yellow' : 'red')
                           }>
                             Principal Verified
                           </Badge>
                         </div>
                       )}
                       <div className="prose prose-invert prose-base max-w-none prose-blue 
                         prose-headings:text-white prose-headings:font-bold prose-headings:tracking-tight
                         prose-p:text-slate-300 prose-p:leading-relaxed
                         prose-strong:text-white prose-strong:font-semibold
                         prose-code:text-blue-300 prose-code:bg-blue-900/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                         prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800 prose-pre:shadow-inner
                         prose-li:text-slate-300
                         prose-hr:border-slate-800">
                          <ReactMarkdown>{reviews[selectedPr.number].reviewComment}</ReactMarkdown>
                       </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {/* Worker Selector Modal */}
      <WorkerSelectorModal
        isOpen={workerModal.isOpen}
        onClose={() => setWorkerModal({ isOpen: false, finding: null })}
        julesApiKey={julesApiKey}
        suggestedSessions={suggestedSessions}
        allSessions={allSessions}
        findingId={workerModal.finding?._id || ''}
        description={workerModal.finding?.body || ''}
        julesReportStatus={julesReportStatus}
        onReportToJules={onReportToJules}
        matchingPrNumber={selectedPr?.number}
      />
    </div>
  );
};

export default CodeReview;
