
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  fetchEnrichedPullRequests, 
  fetchPrDiff, 
  addComment, 
  addLabels, 
  removeLabel, 
  createIssue, 
  fetchPrDetails, 
  fetchComments, 
  fetchReviewComments,
  fetchCheckRuns,
  fetchPrReviews
} from '../services/githubService';
import { generateCodeReview, extractIssuesFromComments } from '../services/geminiService';
import { createSession, findSourceForRepo } from '../services/julesService';
import { storage } from '../services/storageService';
import { EnrichedPullRequest, CodeReviewResult, ProposedIssue } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Eye, Loader2, RefreshCw, Send, FileSearch, Plus, Check, TerminalSquare, RotateCcw, Bot, AlertTriangle, ExternalLink, FileCode, CheckCircle2, ShieldCheck, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

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

  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshingPr, setIsRefreshingPr] = useState(false);
  const [selectedPr, setSelectedPr] = useState<EnrichedPullRequest | null>(null);
  
  const [reviews, setReviews] = useState<Record<number, CodeReviewResult>>({});
  const [statuses, setStatuses] = useState<Record<number, ReviewStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  
  const [actionError, setActionError] = useState<string | null>(null);

  const [extractedIssues, setExtractedIssues] = useState<ExtractedIssueUI[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [creatingIssueId, setCreatingIssueId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<ExtractedIssueUI[]>([]);
  const [reviewedShas, setReviewedShas] = useState<Record<number, string>>({});

  useEffect(() => {
    if (repoName && token) {
      loadPrs().then((data) => {
        const prNumber = location.state?.selectedPrNumber;
        if (prNumber && data) {
           const match = data.find(p => p.number === prNumber);
           if (match) handleSelectPr(match);
        }
      });
      const stored = localStorage.getItem(`audit_reviewed_shas_${repoName}`);
      if (stored) { try { setReviewedShas(JSON.parse(stored)); } catch (e) {} }
    }
  }, [repoName, token]);

  const updateReviewedSha = (prNumber: number, sha: string) => {
    setReviewedShas(prev => {
      const next = { ...prev, [prNumber]: sha };
      localStorage.setItem(`audit_reviewed_shas_${repoName}`, JSON.stringify(next));
      return next;
    });
  };

  const loadPrs = async () => {
    setLoading(true);
    try {
      const data = await fetchEnrichedPullRequests(repoName, token);
      setPrs(data);
      return data;
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const refreshSelectedPr = async () => {
    if (!selectedPr) return;
    setIsRefreshingPr(true);
    try {
      const [updated, checkResults, reviewsData] = await Promise.all([
        fetchPrDetails(repoName, selectedPr.number, token, true),
        fetchCheckRuns(repoName, selectedPr.head.sha, token),
        token ? fetchPrReviews(repoName, selectedPr.number, token) : Promise.resolve([])
      ]);

      const failedCount = checkResults.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out').length;
      const pendingCount = checkResults.filter(r => r.status !== 'completed').length;
      let testStatus: 'passed' | 'failed' | 'pending' | 'unknown' = 'unknown';
      if (failedCount > 0) testStatus = 'failed';
      else if (pendingCount > 0) testStatus = 'pending';
      else if (checkResults.length > 0) testStatus = 'passed';

      const latestReviewsByUser: Record<string, string> = {};
      reviewsData.forEach((r: any) => {
        latestReviewsByUser[r.user.login] = r.state;
      });
      const reviewStates = Object.values(latestReviewsByUser);
      const isApproved = reviewStates.includes('APPROVED') && !reviewStates.includes('CHANGES_REQUESTED');

      const enriched: EnrichedPullRequest = {
        ...updated,
        testStatus,
        checkResults,
        isApproved,
        isBig: (updated.changed_files || 0) > 15,
        isReadyToMerge: updated.mergeable === true,
        isLeaderBranch: ['leader', 'main', 'master', 'develop'].includes(updated.base.ref.toLowerCase())
      };
      setPrs(prev => prev.map(p => p.number === updated.number ? enriched : p));
      setSelectedPr(enriched);
    } catch (e) { console.error(e); } finally { setIsRefreshingPr(false); }
  };

  const handleSelectPr = (pr: EnrichedPullRequest) => {
    setSelectedPr(pr);
    setLoadingMessage("");
    setExtractedIssues([]);
    setAiSuggestions([]);
    setActionError(null);
    
    let review = reviews[pr.number];
    if (!review) {
       review = storage.getPrReview(repoName, pr.number);
       if (review) setReviews(prev => ({ ...prev, [pr.number]: review }));
    }

    if (review?.suggestedIssues) {
       setAiSuggestions(review.suggestedIssues!.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
    }
  };

  const runFullCodeReview = async (pr: EnrichedPullRequest) => {
    if (!token) return;
    setStatuses(prev => ({ ...prev, [pr.number]: 'analyzing' }));
    setErrors(prev => { const next = { ...prev }; delete next[pr.number]; return next; });
    setLoadingMessage("AI Performing Audit...");
    
    try {
      const diff = await fetchPrDiff(repoName, pr.number, token);
      if (!diff) throw new Error("Could not retrieve diff.");
      
      const review = await generateCodeReview(pr, diff);
      storage.savePrReview(repoName, pr.number, review);
      setReviews(prev => ({ ...prev, [pr.number]: review }));
      
      if (pr.number === selectedPr?.number && review.suggestedIssues) {
        setAiSuggestions(review.suggestedIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
      }

      setStatuses(prev => ({ ...prev, [pr.number]: 'posting' }));
      setLoadingMessage("Syncing with GitHub...");
      
      const commentBody = `### 🤖 AI Technical Audit\n\n${review.reviewComment}\n\n*Review automatically published via RepoAuditor.*`;
      await addComment(repoName, token, pr.number, commentBody);

      if (review.labels && review.labels.length > 0) {
        const labelsToRemove = pr.labels.map(l => l.name).filter(name => MANAGED_LABELS.has(name));
        for (const label of labelsToRemove) { await removeLabel(repoName, token, pr.number, label).catch(() => {}); }
        await addLabels(repoName, token, pr.number, review.labels);
      }

      updateReviewedSha(pr.number, pr.head.sha);
      setStatuses(prev => ({ ...prev, [pr.number]: 'completed' }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [pr.number]: e.message || 'Process failed' }));
      setStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
    } finally { setLoadingMessage(""); }
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
      await createIssue(repoName, token, { 
        title: issue.title, 
        body: `${issue.body}\n\n---\n*Extracted from PR #${selectedPr?.number} via RepoAuditor.*`, 
        labels: [...issue.labels, 'follow-up'] 
      });
      if (source === 'human') setExtractedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
      else setAiSuggestions(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
    } catch (e: any) { 
      setActionError(`Creation failed: ${e.message}`); 
    } finally { setCreatingIssueId(null); }
  };

  const handleDispatchTaskToJules = async (issue: ExtractedIssueUI) => {
    if (!julesApiKey || !selectedPr) {
      setActionError("Jules API Key Required.");
      return;
    }
    setCreatingIssueId(issue._id);
    try {
      const sourceId = await findSourceForRepo(julesApiKey, repoName);
      if (!sourceId) throw new Error("Could not identify Jules source.");
      const session = await createSession(julesApiKey, `Audit Fix Task:\n\nTitle: ${issue.title}\nDetails:\n${issue.body}`, sourceId, selectedPr.base.ref, `Audit Fix: ${issue.title.substring(0, 30)}`);
      setAiSuggestions(prev => prev.map(p => p._id === issue._id ? { ...p, isDispatched: true } : p));
      setExtractedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, isDispatched: true } : p));
      navigate('/sessions', { state: { viewSessionName: session.name } });
    } catch (e: any) { 
      setActionError(`Dispatch failed: ${e.message}`); 
    } finally { 
      setCreatingIssueId(null); 
    }
  };

  const currentStatus = selectedPr ? statuses[selectedPr.number] || 'idle' : 'idle';
  const isCurrentReviewed = selectedPr ? reviewedShas[selectedPr.number] === selectedPr.head.sha : false;

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
                  <Button variant="primary" size="sm" onClick={() => runFullCodeReview(selectedPr)} icon={Send} className="flex-1 md:flex-none">
                    {isCurrentReviewed ? 'Refresh' : 'Run Audit'}
                  </Button>
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
             <span className="font-semibold text-white">Active Pull Requests</span>
             <Button variant="ghost" size="sm" onClick={loadPrs} isLoading={loading} icon={RefreshCw} className="h-8 w-8 p-0" />
          </div>
          <div className="max-h-64 lg:max-h-none overflow-y-auto flex-1 p-2 space-y-2 custom-scrollbar">
            {prs.map(pr => (
              <div key={pr.id} onClick={() => handleSelectPr(pr)} className={clsx("p-3 rounded-lg border cursor-pointer transition-all flex flex-col group", selectedPr?.id === pr.id ? "bg-slate-800 border-blue-500/50" : "bg-slate-900/40 border-slate-800 hover:border-slate-700")}>
                <div className="flex justify-between items-start">
                  <h4 className="font-medium text-sm line-clamp-1 pr-2 text-slate-300 group-hover:text-white">{pr.title}</h4>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {reviews[pr.number] && <Bot className="w-3.5 h-3.5 text-blue-400" />}
                    {statuses[pr.number] === 'completed' && <Badge variant="green" className="text-[8px]">Done</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 font-mono">
                   #{pr.number} • {pr.changed_files} files
                   {pr.testStatus === 'failed' && <span className="text-red-400 font-bold ml-auto">Failed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* WORKSPACE */}
        <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative min-h-[500px]">
          {!selectedPr ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8"><Eye className="w-16 h-16 mb-4 opacity-10" /><p className="font-medium text-center">Choose a Pull Request to deploy the AI auditor.</p></div>
          ) : (
            <>
              <div className="p-4 lg:p-6 border-b border-slate-700 bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                 <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2 truncate">
                       {selectedPr.title} 
                       <Button variant="ghost" size="sm" onClick={refreshSelectedPr} isLoading={isRefreshingPr} icon={RefreshCw} className="h-6 w-6 p-0" />
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
                {selectedPr.checkResults && selectedPr.checkResults.length > 0 && (
                   <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">Checks</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                         {selectedPr.checkResults.map((check, idx) => (
                           <a key={idx} href={check.url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-950/50 border border-slate-800 rounded flex items-center justify-between group hover:border-slate-600 transition-all">
                              <span className="text-[10px] text-slate-300 truncate font-medium">{check.name}</span>
                              {check.conclusion === 'success' ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                           </a>
                         ))}
                      </div>
                   </div>
                )}

                {aiSuggestions.length > 0 && (
                   <div className="bg-blue-900/10 border border-blue-500/20 rounded-2xl p-4 lg:p-6 animate-in fade-in">
                      <h4 className="text-blue-300 font-bold flex items-center gap-2 text-sm mb-4">Roadmap</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         {aiSuggestions.map(issue => (
                           <div key={issue._id} className="bg-slate-900/60 rounded-xl p-4 border border-blue-500/20">
                              <h5 className="text-slate-200 font-bold text-xs mb-2 line-clamp-1">{issue.title}</h5>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => handleCreateIssue(issue, 'ai')} disabled={!!issue.isCreated} icon={issue.isCreated ? Check : Plus} className="text-[10px] flex-1 py-1 h-7">Issue</Button>
                                {!issue.isCreated && (
                                  <Button size="sm" variant="ghost" onClick={() => handleDispatchTaskToJules(issue)} icon={TerminalSquare} className="text-[10px] flex-1 py-1 h-7 text-purple-400">AI Solve</Button>
                                )}
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>
                )}

                {(currentStatus === 'analyzing' || currentStatus === 'posting') && (
                   <div className="flex flex-col items-center justify-center py-20 text-slate-400 animate-pulse">
                      <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
                      <p className="text-sm font-bold text-white">{loadingMessage}</p>
                   </div>
                )}

                {reviews[selectedPr.number] && (currentStatus === 'completed' || currentStatus === 'idle') && (
                  <div className="bg-slate-900/50 border border-slate-700/50 p-4 lg:p-8 rounded-2xl animate-in fade-in duration-700">
                     <div className="prose prose-invert prose-sm max-w-none prose-blue">
                        <ReactMarkdown>{reviews[selectedPr.number].reviewComment}</ReactMarkdown>
                     </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeReview;
