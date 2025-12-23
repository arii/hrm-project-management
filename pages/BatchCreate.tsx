
import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Play, X, Loader2, Clipboard, FileUp, Sparkles, BrainCircuit } from 'lucide-react';
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
  id: string; // temp id
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleFiles = (files: FileList) => {
    if (files && files[0]) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setTextInput(text);
        setInputMode('text'); // Switch to text mode to show the content
      };
      reader.readAsText(file);
    }
  };

  const handleAiParse = async () => {
    if (!textInput.trim()) return;
    setIsParsing(true);
    try {
      const issues = await parseIssuesFromText(textInput);
      setParsedIssues(issues.map(i => ({
        ...i,
        id: Math.random().toString(36).substr(2, 9),
        selected: true,
        status: 'idle'
      })));
    } catch (e: any) {
      alert(`AI parsing failed: ${e.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const toggleIssue = (id: string) => {
    setParsedIssues(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i));
  };

  const removeIssue = (id: string) => {
    setParsedIssues(prev => prev.filter(i => i.id !== id));
  };

  const executeBatch = async () => {
    if (!token) {
      alert("Please configure your GitHub Token in settings first.");
      return;
    }

    setIsProcessing(true);
    const issuesToCreate = parsedIssues.filter(i => i.selected && i.status !== 'success');
    
    for (const issue of issuesToCreate) {
      setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'creating' } : i));
      
      try {
        await createIssue(repoName, token, {
          title: issue.title,
          body: issue.body + `\n\n---\n*Priority: ${issue.priority} | Effort: ${issue.effort}*`,
          labels: [...issue.labels, 'ai-generated']
        });
        
        setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'success' } : i));
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (err: any) {
        setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'error', errorMsg: err.message } : i));
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
          <BrainCircuit className="text-purple-400 w-8 h-8" />
          AI Batch Creator
        </h2>
        <p className="text-slate-400">
          Paste meeting notes, messy docs, or feature requests. Gemini 3 will intelligently extract distinct, actionable GitHub issues.
        </p>
      </div>

      {/* Input Selection Tabs */}
      {parsedIssues.length === 0 && (
        <div className="animate-in fade-in duration-500">
          <div className="flex border-b border-slate-700 mb-6">
            <button 
              onClick={() => setInputMode('text')}
              className={clsx(
                "flex items-center gap-2 px-6 py-3 font-medium transition-colors border-b-2",
                inputMode === 'text' 
                  ? "border-primary text-primary" 
                  : "border-transparent text-slate-400 hover:text-white"
              )}
            >
              <Clipboard className="w-4 h-4" />
              Source Text
            </button>
            <button 
              onClick={() => setInputMode('file')}
              className={clsx(
                "flex items-center gap-2 px-6 py-3 font-medium transition-colors border-b-2",
                inputMode === 'file' 
                  ? "border-primary text-primary" 
                  : "border-transparent text-slate-400 hover:text-white"
              )}
            >
              <FileUp className="w-4 h-4" />
              Upload Doc
            </button>
          </div>

          {/* Text Input Zone */}
          {inputMode === 'text' && (
            <div className="bg-surface border border-slate-700 rounded-xl p-6 shadow-xl">
               <textarea 
                 value={textInput}
                 onChange={(e) => setTextInput(e.target.value)}
                 placeholder={`Paste raw notes here...\ne.g.\n"We need to fix the login button styling and also implement a logout confirmation dialog. Oh, and the API docs for auth are outdated."`}
                 className="w-full h-64 bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-200 font-mono text-sm focus:border-primary focus:outline-none resize-none shadow-inner"
               />
               <div className="mt-4 flex justify-end">
                 <Button 
                   onClick={handleAiParse}
                   disabled={!textInput.trim() || isParsing}
                   isLoading={isParsing}
                   icon={Sparkles}
                   size="lg"
                   className="shadow-purple-500/20"
                 >
                   Brainstorm Issues
                 </Button>
               </div>
            </div>
          )}

          {/* File Upload Zone */}
          {inputMode === 'file' && (
            <div 
              className={clsx(
                "border-2 border-dashed rounded-xl p-16 text-center transition-colors cursor-pointer",
                dragActive ? "border-primary bg-primary/10" : "border-slate-700 bg-surface hover:bg-slate-800"
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                className="hidden" 
                accept=".md,.txt,.doc,.docx" 
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <Upload className="w-16 h-16 text-slate-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Drop document to parse</h3>
              <p className="text-slate-400">or click to browse files</p>
            </div>
          )}
        </div>
      )}

      {/* Preview & Action Area */}
      {parsedIssues.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden animate-in slide-in-from-bottom-6 duration-500 shadow-2xl">
          <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur flex justify-between items-center sticky top-0 z-10">
            <div className="flex items-center gap-4">
               <h3 className="font-bold text-white flex items-center gap-2">
                 <Sparkles className="w-4 h-4 text-yellow-400" />
                 Extracted Issues ({parsedIssues.length})
               </h3>
               <button 
                 onClick={() => { setParsedIssues([]); }}
                 className="text-xs text-slate-400 hover:text-white underline"
               >
                 Cancel / Start Over
               </button>
            </div>
            
            <Button
              onClick={executeBatch}
              disabled={isProcessing || !token}
              isLoading={isProcessing}
              variant="success"
              icon={Play}
            >
              {isProcessing ? 'Creating...' : 'Dispatch to GitHub'}
            </Button>
          </div>

          <div className="divide-y divide-slate-700 max-h-[650px] overflow-y-auto">
            {parsedIssues.map((issue) => (
              <div key={issue.id} className={clsx("p-5 transition-all flex gap-4 group border-l-4", issue.selected ? "bg-slate-800/20 border-primary" : "opacity-40 border-transparent")}>
                <div className="pt-1">
                   {issue.status === 'idle' && (
                     <input 
                        type="checkbox" 
                        checked={issue.selected} 
                        onChange={() => toggleIssue(issue.id)}
                        className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-primary cursor-pointer"
                     />
                   )}
                   {issue.status === 'creating' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
                   {issue.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                   {issue.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-2">
                     <h4 className="text-white font-bold truncate pr-4 text-lg">{issue.title}</h4>
                     {issue.status === 'idle' && (
                       <button onClick={() => removeIssue(issue.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                         <X className="w-5 h-5" />
                       </button>
                     )}
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-3">
                     <Badge variant={issue.priority === 'High' ? 'red' : 'blue'}>{issue.priority} Priority</Badge>
                     <Badge variant="purple">{issue.effort} Effort</Badge>
                     {issue.labels.map((l, i) => <Badge key={i} variant="slate">{l}</Badge>)}
                  </div>

                  <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 shadow-inner">
                    <div className="text-xs text-slate-500 font-bold uppercase mb-2">Preview Description</div>
                    <div className="text-sm text-slate-300 font-sans whitespace-pre-wrap leading-relaxed prose prose-invert prose-sm max-w-none">
                      {issue.body}
                    </div>
                  </div>

                  {issue.status === 'error' && (
                    <p className="text-xs text-red-400 mt-2 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {issue.errorMsg}</p>
                  )}
                  {issue.status === 'success' && (
                    <p className="text-xs text-green-400 mt-2 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Issue dispatched successfully</p>
                  )}
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
