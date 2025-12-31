
import React, { useState, useRef } from 'react';
import { Upload, CheckCircle2, AlertCircle, Play, X, Loader2, Clipboard, FileUp, Sparkles, BrainCircuit } from 'lucide-react';
import clsx from 'clsx';
import { createIssue } from '../services/githubService';
import { parseIssuesFromText } from '../services/geminiService';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

interface BatchCreateProps {
  repoName: string;
  token: string;
}

interface ParsedIssueUI {
  id: string; 
  title: string;
  body: string;
  labels: string[];
  priority: string;
  effort: string;
  selected: boolean;
  status: 'idle' | 'creating' | 'success' | 'error';
  errorMsg?: string;
}

const BatchCreate: React.FC<BatchCreateProps> = ({ repoName, token }) => {
  const [inputMode, setInputMode] = useState<'file' | 'text'>('text');
  const [textInput, setTextInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [parsedIssues, setParsedIssues] = useState<ParsedIssueUI[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAiParse = async () => {
    if (!textInput.trim()) return;
    setIsParsing(true);
    try {
      const issues = await parseIssuesFromText(textInput);
      setParsedIssues(issues.map(i => ({ ...i, id: Math.random().toString(36).substr(2, 9), selected: true, status: 'idle' })));
    } catch (e: any) { alert(`AI parsing failed: ${e.message}`); } finally { setIsParsing(false); }
  };

  const executeBatch = async () => {
    if (!token) return alert("Configure token in settings.");
    const issuesToCreate = parsedIssues.filter(i => i.selected && i.status !== 'success');
    if (issuesToCreate.length === 0) return;

    setIsProcessing(true);
    setProgress({ current: 0, total: issuesToCreate.length });
    
    for (let i = 0; i < issuesToCreate.length; i++) {
      const issue = issuesToCreate[i];
      setParsedIssues(prev => prev.map(p => p.id === issue.id ? { ...p, status: 'creating' } : p));
      
      try {
        await createIssue(repoName, token, { title: issue.title, body: `${issue.body}\n\n---\n*Priority: ${issue.priority} | Effort: ${issue.effort}*`, labels: [...issue.labels, 'ai-generated'] });
        setParsedIssues(prev => prev.map(p => p.id === issue.id ? { ...p, status: 'success' } : p));
        setProgress(prev => ({ ...prev, current: i + 1 }));
      } catch (err: any) {
        setParsedIssues(prev => prev.map(p => p.id === issue.id ? { ...p, status: 'error', errorMsg: err.message } : p));
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
          <BrainCircuit className="text-purple-400 w-8 h-8" /> AI Batch Creator
        </h2>
        <p className="text-slate-400">Intelligent structured extraction of GitHub issues from notes or documentation.</p>
      </div>

      {parsedIssues.length === 0 && (
        <div className="animate-in fade-in duration-500">
          <div className="flex border-b border-slate-700 mb-6">
            <button onClick={() => setInputMode('text')} className={clsx("px-6 py-3 font-medium border-b-2 transition-colors", inputMode === 'text' ? "border-primary text-primary" : "border-transparent text-slate-400")}>Source Text</button>
            <button onClick={() => setInputMode('file')} className={clsx("px-6 py-3 font-medium border-b-2 transition-colors", inputMode === 'file' ? "border-primary text-primary" : "border-transparent text-slate-400")}>Upload Doc</button>
          </div>

          <div className="bg-surface border border-slate-700 rounded-xl p-6 shadow-xl">
             <textarea 
               value={textInput} onChange={(e) => setTextInput(e.target.value)}
               placeholder={`Paste raw notes here...`}
               className="w-full h-64 bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-200 font-mono text-sm focus:outline-none resize-none"
             />
             <div className="mt-4 flex justify-end">
               <Button onClick={handleAiParse} disabled={!textInput.trim() || isParsing} isLoading={isParsing} icon={Sparkles} size="lg">Extract Issues</Button>
             </div>
          </div>
        </div>
      )}

      {parsedIssues.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-slate-700 bg-slate-800/80 flex justify-between items-center sticky top-0 z-10">
            <div className="flex items-center gap-4">
               <h3 className="font-bold text-white">Extracted Issues ({parsedIssues.length})</h3>
               <button onClick={() => setParsedIssues([])} className="text-xs text-slate-400 underline">Start Over</button>
            </div>
            
            <div className="flex items-center gap-4">
               {isProcessing && <div className="text-xs font-mono text-blue-400 animate-pulse">Progress: {progress.current}/{progress.total}</div>}
               <Button onClick={executeBatch} disabled={isProcessing || !token} isLoading={isProcessing} variant="success" icon={Play}>
                 {isProcessing ? 'Creating...' : 'Dispatch to GitHub'}
               </Button>
            </div>
          </div>

          <div className="divide-y divide-slate-700 max-h-[650px] overflow-y-auto">
            {parsedIssues.map((issue) => (
              <div key={issue.id} className={clsx("p-5 transition-all flex gap-4 border-l-4", issue.selected ? "bg-slate-800/20 border-primary" : "opacity-40 border-transparent")}>
                <div className="pt-1">
                   {issue.status === 'idle' && <input type="checkbox" checked={issue.selected} onChange={() => setParsedIssues(prev => prev.map(p => p.id === issue.id ? { ...p, selected: !p.selected } : p))} className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-primary cursor-pointer" />}
                   {issue.status === 'creating' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
                   {issue.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                   {issue.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-2">
                     <h4 className="text-white font-bold truncate pr-4 text-lg">{issue.title}</h4>
                     {issue.status === 'idle' && <button onClick={() => setParsedIssues(prev => prev.filter(p => p.id !== issue.id))} className="text-slate-600 hover:text-red-400 transition-opacity"><X className="w-5 h-5" /></button>}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                     <Badge variant={issue.priority === 'High' ? 'red' : 'blue'}>{issue.priority}</Badge>
                     <Badge variant="purple">{issue.effort}</Badge>
                  </div>
                  <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 text-sm text-slate-300 leading-relaxed">{issue.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchCreate;
