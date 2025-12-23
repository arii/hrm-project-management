
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchEnrichedPullRequests, fetchPrDiff, addComment, addLabels, removeLabel, fetchIssueDetails, createIssue, fetchPrDetails, fetchComments, fetchReviewComments } from '../services/githubService';
import { generateCodeReview, generateRecoveryPlan, extractIssuesFromComments } from '../services/geminiService';
import { createSession, findSourceForRepo } from '../services/julesService';
import { EnrichedPullRequest, CodeReviewResult, RecoveryAnalysisResult, JulesSession, ProposedIssue } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Eye, CheckCircle2, Loader2, Play, Bot, AlertCircle, RefreshCw, ExternalLink, GitBranch, XCircle, Ambulance, RotateCcw, Send, FileSearch, Plus, Check } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface CodeReviewProps {
  repoName: string;
  token: string;
  julesApiKey?: string;
}

type ReviewStatus = 'idle' | 'reviewing' | 'posting' | 'posted' | 'error';
type ExtractedIssueUI = ProposedIssue & { _id: string; isCreated?: boolean };

const MANAGED_LABELS = new Set([
  'small', 'medium', 'large', 'xl', 
  'needs-improvement', 'ready-for-approval'
]);

const CodeReview: React.FC<CodeReviewProps> = ({ repoName, token, julesApiKey }) => {
  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshingPr, setIsRefreshingPr] = useState(false);
  const [selectedPr, setSelectedPr] = useState<EnrichedPullRequest | null>(null);
  const navigate = useNavigate();
  
  // Review State
  const [reviews, setReviews] = useState<Record<number, CodeReviewResult>>({});
  const [statuses, setStatuses] = useState<Record<number, ReviewStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  
  // Recovery/Agent interaction
  const [isDispatchingJules, setIsDispatchingJules] = useState(false);

  // Scoped Issue Extraction State
  const [extractedIssues, setExtractedIssues] = useState<ExtractedIssueUI[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [creatingIssueId, setCreatingIssueId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<ExtractedIssueUI[]>([]);

  // Cache reviewed commits
  const [reviewedShas, setReviewedShas] = useState<Record<number, string>>({});

  useEffect(() => {
    if (repoName && token) {
      loadPrs();
      const stored = localStorage.getItem(`audit_reviewed_shas_${repoName}`);
      if (stored) {
        try { setReviewedShas(JSON.parse(stored)); } catch (e) { console.warn(e); }
      }
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
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const refreshSelectedPr = async () => {
    if (!selectedPr) return;
    setIsRefreshingPr(true);
    try {
      const updated = await fetchPrDetails(repoName, selectedPr.number, token, true);
      const enriched: EnrichedPullRequest = {
        ...updated,
        testStatus: selectedPr.testStatus,
        isBig: (updated.changed_files || 0) > 15,
        isReadyToMerge: updated.mergeable === true,
        isLeaderBranch: selectedPr.isLeaderBranch
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
    
    // Check if we already have a review cached
    if (reviews[pr.number]) {
      const cached = reviews[pr.number];
      if (cached.suggestedIssues) {
         setAiSuggestions(cached.suggestedIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
      }
    }
  };

  const isPrReviewed = (pr: EnrichedPullRequest) => reviewedShas[pr.number] === pr.head.sha;
  const isTroubledPr = (pr: EnrichedPullRequest) => (pr.comments && pr.comments > 15) || pr.testStatus === 'failed' || pr.mergeable === false;

  // --- Core Action: AI Review with Auto-Post ---

  const runFullCodeReview = async (pr: EnrichedPullRequest) => {
    if (!token) return alert("Token required.");
    setStatuses(prev => ({ ...prev, [pr.number]: 'reviewing' }));
    setErrors(prev => { const next = { ...prev }; delete next[pr.number]; return next; });
    setLoadingMessage("Fetching diff & analyzing changes...");
    
    try {
      // 1. Generate Review
      const diff = await fetchPrDiff(repoName, pr.number, token);
      if (!diff) throw new Error("Could not retrieve PR diff.");
      
      const review = await generateCodeReview(pr, diff);
      setReviews(prev => ({ ...prev, [pr.number]: review }));
      
      // Update suggestions for UI
      if (pr.number === selectedPr?.number && review.suggestedIssues) {
        setAiSuggestions(review.suggestedIssues.map(i => ({ ...i, _id: Math.random().toString(36).substr(2, 9) })));
      }

      // 2. Automatically Post
      setStatuses(prev => ({ ...prev, [pr.number]: 'posting' }));
      setLoadingMessage("Posting review to GitHub...");
      
      let loopNote = "";
      if (review.suggestedIssues && review.suggestedIssues.length > 0) {
        loopNote = `\n\n> ⚠️ **Follow-up Opportunity**: Identified ${review.suggestedIssues.length} potentially out-of-scope tasks. Extracting these will help land this PR faster.`;
      }
      const commentBody = `@jules: **AI Code Review**\n\n${review.reviewComment}${loopNote}`;
      await addComment(repoName, token, pr.number, commentBody);

      if (review.labels && review.labels.length > 0) {
        const labelsToRemove = pr.labels.map(l => l.name).filter(name => MANAGED_LABELS.has(name));
        for (const label of labelsToRemove) { await removeLabel(repoName, token, pr.number, label).catch(() => {}); }
        await addLabels(repoName, token, pr.number, review.labels);
      }

      updateReviewedSha(pr.number, pr.head.sha);
      setStatuses(prev => ({ ...prev, [pr.number]: 'posted' }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [pr.number]: e.message || 'Process failed' }));
      setStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
    } finally { setLoadingMessage(""); }
  };

  // --- Discovery Feature: Scan Human Comments for scoped tasks ---

  const handleScanComments = async () => {
    if (!selectedPr) return;
    setIsExtracting(true);
    setLoadingMessage("Scanning human discussion for follow-ups...");
    try {
      const [issueComments, reviewComments] = await Promise.all([
        fetchComments(repoName, selectedPr.number, token),
        fetchReviewComments(repoName, selectedPr.number, token)
      ]);
      const allComments = [
        ...issueComments.map(c => ({ id: c.id, user: c.user.login, body: c.body, url: c.html_url })),
        ...reviewComments.map(c => ({ id: c.id, user: c.user.login, body: c.body, url: c.html_url }))
      ];
      if (allComments.length === 0) {
        alert("No comments found to scan.");
        return;
      }
      const proposed = await extractIssuesFromComments(allComments);
      if (proposed.length === 0) alert("No out-of-scope tasks detected in discussion.");
      else setExtractedIssues(proposed.map(p => ({ ...p, _id: Math.random().toString(36).substr(2, 9) })));
    } catch (e) { alert("Comment scan failed."); } finally { setIsExtracting(false); setLoadingMessage(""); }
  };

  const handleCreateIssue = async (issue: ExtractedIssueUI, source: 'ai' | 'human') => {
    if (!token) return;
    setCreatingIssueId(issue._id);
    try {
      const bodyWithContext = `${issue.body}\n\n---\n*Extracted from PR #${selectedPr?.number} via RepoAuditor AI.*`;
      await createIssue(repoName, token, { title: issue.title, body: bodyWithContext, labels: [...issue.labels, 'follow-up'] });
      if (source === 'human') setExtractedIssues(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
      else setAiSuggestions(prev => prev.map(p => p._id === issue._id ? { ...p, isCreated: true } : p));
    } catch (e) { alert("Failed to create issue."); } finally { setCreatingIssueId(null); }
  };

  const handleDispatchJules = async (mode: 'repair' | 'rewrite') => {
    if (!selectedPr || !julesApiKey) return alert("Jules API Key required.");
    setIsDispatchingJules(true);
    try {
       const sourceId = await findSourceForRepo(julesApiKey, repoName);
       if (!sourceId) throw new Error("Source not found.");
       const prompt = mode === 'repair' 
         ? `Checkout '${selectedPr.head.ref}'. Fix tests/linting. PR #${selectedPr.number}` 
         : `Fresh implementation of '${selectedPr.title}' from '${selectedPr.base.ref}'.`;
       await createSession(julesApiKey, prompt, sourceId, mode === 'repair' ? selectedPr.head.ref : selectedPr.base.ref, `Recovery: #${selectedPr.number}`);
       alert("Jules session dispatched.");
    } catch (e: any) { alert(e.message); } finally { setIsDispatchingJules(false); }
  };

  const currentReview = selectedPr ? reviews[selectedPr.number] : null;
  const currentStatus = selectedPr ? statuses[selectedPr.number] || 'idle' : 'idle';
  const isCurrentReviewed = selectedPr ? isPrReviewed(selectedPr) : false;
  const isTroubled = selectedPr ? isTroubledPr(selectedPr) : false;

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6 shrink-0">
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Eye className="text-blue-400 w-8 h-8" />
          Technical AI Review
        </h2>
        <p className="text-slate-400">Automatic diff analysis and follow-up work identification powered by Gemini 3.</p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* LEFT: PR List */}
        <div className="w-[500px] bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden shrink-0">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
             <span className="font-semibold text-white">Open PRs ({prs.length})</span>
             <Button variant="ghost" size="sm" onClick={loadPrs} isLoading={loading} icon={RefreshCw} className="h-8 w-8 p-0" />
          </div>
          
          <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {prs.map(pr => (
              <div key={pr.id} onClick={() => handleSelectPr(pr)} className={clsx("p-3 rounded-lg border cursor-pointer transition-all flex flex-col", selectedPr?.id === pr.id ? "bg-slate-800 border-blue-500/50" : "bg-slate-900/40 border-slate-800")}>
                <div className="flex justify-between items-start">
                  <h4 className="font-medium text-sm line-clamp-1 pr-2 text-slate-300">{pr.title}</h4>
                  <div className="shrink-0">
                    {statuses[pr.number] === 'posted' ? <Badge variant="green">Posted</Badge> : isPrReviewed(pr) ? <Badge variant="gray">Reviewed</Badge> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">#{pr.number} • {pr.user.login}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Review Panel */}
        <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative">
          {!selectedPr ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-900/20"><Eye className="w-16 h-16 mb-4 opacity-20" /><p>Select a Pull Request to run AI analysis.</p></div>
          ) : (
            <>
              <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex justify-between items-start shrink-0">
                 <div className="flex-1 min-w-0 pr-4">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2 truncate">
                       {selectedPr.title} 
                       <Button variant="ghost" size="sm" onClick={refreshSelectedPr} isLoading={isRefreshingPr} icon={RefreshCw} className="h-6 w-6 p-0" title="Refresh PR status" />
                    </h3>
                    <div className="flex gap-4 text-xs text-slate-400">
                      <span>Head: <code className="bg-slate-900 px-1 py-0.5 rounded text-blue-300">{selectedPr.head.ref}</code></span>
                      <span>Base: <code className="bg-slate-900 px-1 py-0.5 rounded text-purple-300">{selectedPr.base.ref}</code></span>
                    </div>
                 </div>
                 <div className="flex items-center gap-2">
                     <Button variant="secondary" size="sm" onClick={handleScanComments} disabled={isExtracting} isLoading={isExtracting} icon={FileSearch}>Scan Discussion</Button>
                     {(currentStatus === 'idle' || currentStatus === 'posted' || currentStatus === 'error') && (
                        <Button variant="primary" onClick={() => runFullCodeReview(selectedPr)} icon={Play}>{isCurrentReviewed ? 'Re-Run & Post' : 'Run Review & Post'}</Button>
                     )}
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-[#0B1120]">
                {/* AI Suggestions (Follow-ups found during review) */}
                {aiSuggestions.length > 0 && (
                   <div className="bg-blue-900/10 border border-blue-500/30 rounded-xl p-5 mb-6 animate-in fade-in">
                      <h4 className="text-blue-300 font-bold flex items-center gap-2 mb-4"><Bot className="w-5 h-5" /> Scoped Follow-up Suggestions</h4>
                      <div className="space-y-3">
                         {aiSuggestions.map(issue => (
                           <div key={issue._id} className={clsx("bg-slate-900/50 rounded-lg p-4 border", issue.isCreated ? "border-green-500/30 bg-green-900/10" : "border-blue-500/20")}>
                              <div className="flex justify-between items-start">
                                 <div className="flex-1 mr-4">
                                    <h5 className="text-slate-200 font-bold text-sm">{issue.title}</h5>
                                    <p className="text-xs text-blue-300/70 mt-1 italic">{issue.reason}</p>
                                 </div>
                                 <Button size="sm" variant={issue.isCreated ? "ghost" : "primary"} onClick={() => handleCreateIssue(issue, 'ai')} disabled={!!issue.isCreated || creatingIssueId === issue._id} isLoading={creatingIssueId === issue._id} icon={issue.isCreated ? Check : Plus}>
                                    {issue.isCreated ? "Created" : "Extract"}
                                 </Button>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>
                )}

                {/* Extracted from Discussion */}
                {extractedIssues.length > 0 && (
                   <div className="bg-purple-900/10 border border-purple-500/30 rounded-xl p-5 mb-6 animate-in fade-in">
                      <h4 className="text-purple-300 font-bold flex items-center gap-2 mb-4"><FileSearch className="w-5 h-5" /> Discussion Follow-ups</h4>
                      <div className="space-y-3">
                         {extractedIssues.map(issue => (
                           <div key={issue._id} className="bg-slate-900/50 rounded-lg p-4 border border-purple-500/20">
                              <div className="flex justify-between items-start">
                                 <div className="flex-1 mr-4"><h5 className="text-slate-200 font-bold text-sm">{issue.title}</h5></div>
                                 <Button size="sm" variant={issue.isCreated ? "ghost" : "primary"} onClick={() => handleCreateIssue(issue, 'human')} disabled={!!issue.isCreated} icon={issue.isCreated ? Check : Plus}>
                                    {issue.isCreated ? "Created" : "Punt to Backlog"}
                                 </Button>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>
                )}

                {isTroubled && (
                  <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-5 mb-6">
                     <h4 className="text-red-300 font-bold flex items-center gap-2 mb-3"><Bot className="w-5 h-5" /> Recovery Assistant</h4>
                     <div className="flex gap-3">
                        <Button variant="secondary" size="sm" onClick={() => handleDispatchJules('repair')} disabled={isDispatchingJules} icon={Ambulance}>Repair</Button>
                        <Button variant="secondary" size="sm" onClick={() => handleDispatchJules('rewrite')} disabled={isDispatchingJules} icon={RotateCcw}>Clean Retry</Button>
                     </div>
                  </div>
                )}

                {(currentStatus === 'reviewing' || currentStatus === 'posting') && (
                   <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                      <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
                      <p className="text-lg font-medium">{currentStatus === 'reviewing' ? 'Analyzing Code' : 'Posting to GitHub'}</p>
                      <p className="text-sm opacity-70 mt-2 font-mono bg-slate-900/50 px-3 py-1 rounded">{loadingMessage}</p>
                   </div>
                )}

                {currentReview && (currentStatus === 'posted' || currentStatus === 'idle') && (
                  <div className="space-y-6 animate-in fade-in">
                     <div className="bg-blue-900/10 border border-blue-500/20 p-6 rounded-xl">
                        <div className="flex justify-between items-center mb-6">
                           <h4 className="text-blue-300 font-bold flex items-center gap-2 text-lg"><Bot className="w-6 h-6" /> Review Analysis</h4>
                           <Badge variant="green">Auto-Posted</Badge>
                        </div>
                        <div className="prose prose-invert prose-blue max-w-none"><ReactMarkdown>{currentReview.reviewComment}</ReactMarkdown></div>
                     </div>
                  </div>
                )}

                {currentStatus === 'idle' && !currentReview && (
                  <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
                     <h4 className="text-slate-400 uppercase text-xs font-bold mb-4">PR Context</h4>
                     <ReactMarkdown className="prose prose-invert prose-sm">{selectedPr.body || "*No description.*"}</ReactMarkdown>
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
