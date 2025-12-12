
import React, { useState, useEffect } from 'react';
import { fetchEnrichedPullRequests, fetchPrDiff, addComment, addLabels } from '../services/githubService';
import { generateCodeReview } from '../services/geminiService';
import { EnrichedPullRequest, CodeReviewResult } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Eye, CheckCircle2, Loader2, MessageSquare, Play, User, FileCode, Bot, CheckSquare, Upload, AlertCircle, RefreshCw, ThumbsUp, Sparkles, ExternalLink, GitBranch, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface CodeReviewProps {
  repoName: string;
  token: string;
}

type ReviewStatus = 'idle' | 'reviewing' | 'posting' | 'posted' | 'error';

const CodeReview: React.FC<CodeReviewProps> = ({ repoName, token }) => {
  const [prs, setPrs] = useState<EnrichedPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPr, setSelectedPr] = useState<EnrichedPullRequest | null>(null);
  
  // Batch & Review State
  const [reviews, setReviews] = useState<Record<number, CodeReviewResult>>({});
  const [statuses, setStatuses] = useState<Record<number, ReviewStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [checkedPrs, setCheckedPrs] = useState<Set<number>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  // Persist reviewed commits to prevent re-reviewing unchanged code
  const [reviewedShas, setReviewedShas] = useState<Record<number, string>>({});

  useEffect(() => {
    if (repoName && token) {
      loadPrs();
      // Load reviewed shas from local storage
      const stored = localStorage.getItem(`audit_reviewed_shas_${repoName}`);
      if (stored) {
        try {
          setReviewedShas(JSON.parse(stored));
        } catch (e) {
          console.warn("Failed to parse reviewed shas", e);
        }
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // --- Selection Logic ---

  const handleSelectPr = (pr: EnrichedPullRequest) => {
    setSelectedPr(pr);
  };

  const isPrReviewed = (pr: EnrichedPullRequest) => {
    return reviewedShas[pr.number] === pr.head.sha;
  };

  const toggleCheck = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(checkedPrs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCheckedPrs(next);
  };

  const toggleSelectAll = () => {
    // Filter out already reviewed PRs when selecting all
    const actionablePrs = prs.filter(p => !isPrReviewed(p));
    
    if (checkedPrs.size === actionablePrs.length && checkedPrs.size > 0) {
      setCheckedPrs(new Set());
    } else {
      setCheckedPrs(new Set(actionablePrs.map(p => p.number)));
    }
  };

  const selectRecommended = () => {
    // Select PRs with no conflicts, passed tests, AND not already reviewed
    const recommendedIds = prs
      .filter(p => p.mergeable === true && p.testStatus === 'passed' && !isPrReviewed(p))
      .map(p => p.number);
    setCheckedPrs(new Set(recommendedIds));
  };

  // --- Core Actions ---

  const processReviewForPr = async (pr: EnrichedPullRequest) => {
    setStatuses(prev => ({ ...prev, [pr.number]: 'reviewing' }));
    setErrors(prev => { const next = { ...prev }; delete next[pr.number]; return next; });
    
    try {
      // 1. Generate
      const diff = await fetchPrDiff(repoName, pr.number, token);
      const review = await generateCodeReview(pr, diff);
      
      // Append Standard Checklist
      const checklist = `\n\n---\n### ✅ Pre-Merge Checklist\nPlease verify the following before merging:\n- [ ] No merge conflicts with base branch (\`git fetch origin && git merge origin/${pr.base.ref}\`)\n- [ ] \`pnpm run build\` passes\n- [ ] \`pnpm run lint\` passes\n- [ ] \`pnpm run test:all\` passes`;
      review.reviewComment += checklist;

      setReviews(prev => ({ ...prev, [pr.number]: review }));
      
      // 2. Post immediately
      setStatuses(prev => ({ ...prev, [pr.number]: 'posting' }));
      const commentBody = `@jules: **AI Code Review**\n\n${review.reviewComment}`;
      await addComment(repoName, token, pr.number, commentBody);

      if (review.labels && review.labels.length > 0) {
        await addLabels(repoName, token, pr.number, review.labels);
      }

      // 3. Mark as Done
      updateReviewedSha(pr.number, pr.head.sha);
      setStatuses(prev => ({ ...prev, [pr.number]: 'posted' }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [pr.number]: e.message || 'Review failed' }));
      setStatuses(prev => ({ ...prev, [pr.number]: 'error' }));
    }
  };

  // --- Batch Handlers ---

  const handleBatchProcess = async () => {
    if (checkedPrs.size === 0) return;
    if (!window.confirm(`Auto-review and post comments for ${checkedPrs.size} PRs?`)) return;

    setIsBatchProcessing(true);
    const targetIds = (Array.from(checkedPrs) as number[]).filter(id => statuses[id] !== 'reviewing' && statuses[id] !== 'posting');
    
    // Process sequentially to be nice to APIs
    for (const id of targetIds) {
      const pr = prs.find(p => p.number === id);
      if (pr) {
        await processReviewForPr(pr);
      }
    }
    setIsBatchProcessing(false);
  };

  // --- Render Helpers ---

  const getStatusIcon = (status: ReviewStatus) => {
    switch (status) {
      case 'reviewing': return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
      case 'posting': return <Loader2 className="w-4 h-4 animate-spin text-purple-400" />;
      case 'posted': return <CheckSquare className="w-4 h-4 text-green-400" />; 
      case 'error': return <AlertCircle className="w-4 h-4 text-red-400" />;
      default: return null;
    }
  };

  const currentReview = selectedPr ? reviews[selectedPr.number] : null;
  const currentStatus = selectedPr ? statuses[selectedPr.number] || 'idle' : 'idle';
  const currentError = selectedPr ? errors[selectedPr.number] : null;
  const isCurrentReviewed = selectedPr ? isPrReviewed(selectedPr) : false;

  // Calculate stats for recommended button
  const recommendedCount = prs.filter(p => p.mergeable === true && p.testStatus === 'passed' && !isPrReviewed(p)).length;

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6 shrink-0">
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Eye className="text-blue-400 w-8 h-8" />
          AI Code Review
        </h2>
        <p className="text-slate-400">Batch review Pull Requests. Reviews are automatically posted to GitHub.</p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* LEFT: PR List */}
        <div className="w-[500px] bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden shrink-0">
          
          {/* Header & Batch Controls */}
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex flex-col gap-3">
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                   <input 
                     type="checkbox" 
                     checked={checkedPrs.size > 0 && checkedPrs.size === prs.filter(p => !isPrReviewed(p)).length}
                     onChange={toggleSelectAll}
                     className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 cursor-pointer"
                   />
                   <span className="font-semibold text-white">Open PRs ({prs.length})</span>
                </div>
                <div className="flex gap-2">
                  {recommendedCount > 0 && (
                    <button 
                      onClick={selectRecommended}
                      className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded hover:bg-green-500/20 transition-colors flex items-center gap-1"
                      title="Select unreviewed PRs with passing tests and no conflicts"
                    >
                      <Sparkles className="w-3 h-3" /> Recommended ({recommendedCount})
                    </button>
                  )}
                  <Button variant="ghost" size="sm" onClick={loadPrs} isLoading={loading} icon={RefreshCw} className="h-8 w-8 p-0" />
                </div>
             </div>

             {/* Batch Actions Toolbar */}
             {checkedPrs.size > 0 && (
                <div className="animate-in fade-in slide-in-from-top-2">
                   <Button 
                     size="sm" 
                     variant="primary" 
                     onClick={handleBatchProcess} 
                     disabled={isBatchProcessing}
                     isLoading={isBatchProcessing}
                     icon={Play}
                     className="w-full text-xs font-bold"
                   >
                     {isBatchProcessing ? 'Processing...' : `Auto-Review ${checkedPrs.size} PRs`}
                   </Button>
                </div>
             )}
          </div>
          
          <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {prs.length === 0 && !loading && (
              <div className="text-center py-10 text-slate-500">No open PRs found.</div>
            )}
            {prs.map(pr => {
              const status = statuses[pr.number] || 'idle';
              const reviewed = isPrReviewed(pr);
              const isChecked = checkedPrs.has(pr.number);
              const isDisabled = reviewed && status !== 'reviewing' && status !== 'posting'; // Disable selection if reviewed (unless actively processing)
              
              return (
                <div 
                  key={pr.id}
                  onClick={() => handleSelectPr(pr)}
                  className={clsx(
                    "p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3 relative group",
                    selectedPr?.id === pr.id 
                      ? "bg-slate-800 border-blue-500/50 ring-1 ring-blue-500/20 shadow-lg" 
                      : "bg-slate-900/40 border-slate-800 hover:bg-slate-800 hover:border-slate-700",
                    isDisabled && "opacity-75"
                  )}
                >
                  {/* Checkbox */}
                  <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                     <input 
                       type="checkbox" 
                       checked={isChecked}
                       disabled={isDisabled}
                       onChange={(e) => toggleCheck(pr.number, e)}
                       className={clsx(
                         "w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500",
                         isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                       )}
                     />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h4 className={clsx("font-medium text-sm line-clamp-1 pr-2", selectedPr?.id === pr.id ? "text-white" : "text-slate-300")}>
                        {pr.title}
                      </h4>
                      <div className="shrink-0 pt-0.5">
                         {status === 'idle' && reviewed ? (
                             <Badge variant="green" icon={CheckCircle2}>Reviewed</Badge>
                         ) : (
                             getStatusIcon(status)
                         )}
                      </div>
                    </div>
                    
                    {/* Status Icons Row */}
                    <div className="flex items-center gap-3 mt-1.5">
                       {/* PR Number Link */}
                       <a 
                         href={pr.html_url} 
                         target="_blank" 
                         rel="noopener noreferrer" 
                         onClick={(e) => e.stopPropagation()}
                         className="flex items-center gap-1 text-xs text-blue-400 hover:underline hover:text-blue-300"
                       >
                         <ExternalLink className="w-3 h-3" /> #{pr.number}
                       </a>
                       
                       {/* Branch Link */}
                       <a 
                         href={`https://github.com/${repoName}/tree/${pr.head.ref}`} 
                         target="_blank" 
                         rel="noopener noreferrer" 
                         onClick={(e) => e.stopPropagation()}
                         className="flex items-center gap-1 text-xs text-slate-500 hover:text-white max-w-[100px] truncate"
                         title={pr.head.ref}
                       >
                         <GitBranch className="w-3 h-3" /> {pr.head.ref}
                       </a>

                       <div className="flex items-center gap-2 ml-auto">
                           {/* Test Status */}
                           <div title={`Tests: ${pr.testStatus}`} className={clsx("flex items-center", pr.testStatus === 'passed' ? "text-green-500" : pr.testStatus === 'failed' ? "text-red-500" : "text-slate-600")}>
                               {pr.testStatus === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5" /> : pr.testStatus === 'failed' ? <XCircle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5" />}
                           </div>

                           {/* Conflict Status */}
                           {pr.mergeable === false ? (
                              <div title="Merge Conflicts" className="text-red-500"><AlertTriangle className="w-3.5 h-3.5" /></div>
                           ) : (
                              <div title="Mergeable" className="text-slate-600"><ShieldCheck className="w-3.5 h-3.5" /></div>
                           )}
                       </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Review Panel */}
        <div className="flex-1 bg-surface border border-slate-700 rounded-xl flex flex-col overflow-hidden relative">
          {!selectedPr ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-900/20">
               <Eye className="w-16 h-16 mb-4 opacity-20" />
               <p>Select a Pull Request to view details.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex justify-between items-start shrink-0">
                 <div>
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                       {selectedPr.title} 
                       <a href={selectedPr.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-blue-400 transition-colors">
                         <ExternalLink className="w-5 h-5" />
                       </a>
                    </h3>
                    <div className="flex gap-4 text-sm text-slate-400">
                      <span className="flex items-center gap-1">
                        Source: 
                        <a href={`https://github.com/${repoName}/tree/${selectedPr.head.ref}`} target="_blank" rel="noopener noreferrer" className="bg-slate-900 px-1 py-0.5 rounded text-blue-300 hover:underline">
                           {selectedPr.head.ref}
                        </a>
                      </span>
                      <span className="flex items-center gap-1">
                        Target: 
                        <code className="bg-slate-900 px-1 py-0.5 rounded text-purple-300">{selectedPr.base.ref}</code>
                      </span>
                    </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                     {isCurrentReviewed && (
                        <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Reviewed
                        </div>
                     )}
                     
                     {(currentStatus === 'idle' || currentStatus === 'posted' || currentStatus === 'error') && (
                        <Button 
                          variant="primary" 
                          onClick={() => processReviewForPr(selectedPr)} 
                          icon={Play}
                        >
                           {isCurrentReviewed ? 'Re-Run Auto Review' : 'Start Auto Review'}
                        </Button>
                     )}
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-[#0B1120]">
                {/* Error State */}
                {currentError && (
                  <div className="bg-red-900/20 border border-red-800 text-red-200 p-4 rounded-lg mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    {currentError}
                  </div>
                )}

                {/* Loading State */}
                {(currentStatus === 'reviewing' || currentStatus === 'posting') && (
                   <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                      <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
                      <p className="text-lg font-medium">
                         {currentStatus === 'reviewing' ? 'Analyzing Code Diff...' : 'Posting Review to GitHub...'}
                      </p>
                      <p className="text-sm opacity-70">
                         {currentStatus === 'reviewing' ? 'Gemini is reading the changes.' : 'Finalizing comment.'}
                      </p>
                   </div>
                )}

                {/* PR Description (Context) if no review active in view */}
                {currentStatus === 'idle' && !currentReview && (
                  <div className="prose prose-invert prose-sm max-w-none">
                     <h4 className="text-slate-400 uppercase text-xs font-bold mb-2">PR Description</h4>
                     <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                        <ReactMarkdown>{selectedPr.body || "*No description provided.*"}</ReactMarkdown>
                     </div>
                     <div className="mt-8 text-center text-slate-500">
                        <p>Click "Start Auto Review" to analyze {selectedPr.changed_files} changed files.</p>
                     </div>
                  </div>
                )}

                {/* Review Result */}
                {currentReview && (currentStatus === 'posted' || currentStatus === 'idle') && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                     <div className="bg-blue-900/10 border border-blue-500/20 p-6 rounded-xl relative">
                        <div className="absolute top-4 right-4 text-xs text-blue-400 font-mono opacity-50">
                           sha: {selectedPr.head.sha.substring(0, 7)}
                        </div>
                        <h4 className="text-blue-300 font-bold mb-4 flex items-center gap-2">
                           <Bot className="w-5 h-5" /> AI Review Summary
                        </h4>
                        <div className="prose prose-invert prose-blue max-w-none">
                           <ReactMarkdown>{currentReview.reviewComment}</ReactMarkdown>
                        </div>
                     </div>
                     
                     {currentReview.labels.length > 0 && (
                       <div>
                          <h4 className="text-slate-400 text-xs font-bold uppercase mb-2">Suggested Labels</h4>
                          <div className="flex gap-2">
                             {currentReview.labels.map(l => (
                                <Badge key={l} variant="blue" icon={CheckCircle2}>{l}</Badge>
                             ))}
                          </div>
                       </div>
                     )}
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
