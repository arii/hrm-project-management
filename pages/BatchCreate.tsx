
import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Play, X, Loader2, Clipboard, FileUp } from 'lucide-react';
import clsx from 'clsx';
import { createIssue } from '../services/githubService';

interface BatchCreateProps {
  repoName: string;
  token: string;
}

interface ParsedIssue {
  id: string; // temp id
  title: string;
  body: string;
  labels: string[];
  selected: boolean;
  status: 'idle' | 'creating' | 'success' | 'error';
  errorMsg?: string;
}

const BatchCreate: React.FC<BatchCreateProps> = ({ repoName, token }) => {
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  const [textInput, setTextInput] = useState('');
  
  const [dragActive, setDragActive] = useState(false);
  const [parsedIssues, setParsedIssues] = useState<ParsedIssue[]>([]);
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

  const parseMarkdown = (text: string): ParsedIssue[] => {
    const lines = text.split('\n');
    const issues: ParsedIssue[] = [];
    let currentSection = '';
    let currentTitle = '';
    let currentBody: string[] = [];

    // Heuristic: Check if H2 exists. If so, H1 is a section label. If not, H1 is the title.
    const hasH2 = lines.some(l => l.startsWith('## '));

    const pushIssue = () => {
      if (currentTitle) {
        issues.push({
          id: Math.random().toString(36).substr(2, 9),
          title: currentTitle,
          body: currentBody.join('\n').trim(),
          labels: currentSection ? [currentSection] : [],
          selected: true,
          status: 'idle'
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // const trimmed = line.trim(); // Unused

      if (line.startsWith('# ')) {
        if (hasH2) {
          // New Section
          currentSection = line.replace('# ', '').trim();
        } else {
          // New Issue (Flat structure)
          pushIssue();
          currentTitle = line.replace('# ', '').trim();
          currentBody = [];
        }
      } else if (line.startsWith('## ') && hasH2) {
        // New Issue (Nested structure)
        pushIssue();
        currentTitle = line.replace('## ', '').trim();
        currentBody = [];
      } else {
        if (currentTitle || (currentSection && !hasH2)) {
          currentBody.push(line);
        }
      }
    }
    pushIssue(); // Push last one
    return issues;
  };

  const handleFiles = (files: FileList) => {
    if (files && files[0]) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const issues = parseMarkdown(text);
        setParsedIssues(issues);
      };
      reader.readAsText(file);
    }
  };

  const handleTextParse = () => {
    if (!textInput.trim()) return;
    const issues = parseMarkdown(textInput);
    setParsedIssues(issues);
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
    
    // We process sequentially to avoid rate limits and show nice progress
    for (const issue of issuesToCreate) {
      setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'creating' } : i));
      
      try {
        await createIssue(repoName, token, {
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        });
        
        setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'success' } : i));
        // Small delay to be nice to API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        setParsedIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status: 'error', errorMsg: err.message } : i));
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <FileText className="text-primary w-8 h-8" />
          Batch Issue Creator
        </h2>
        <p className="text-slate-400">
          Create multiple issues at once from a Markdown plan. 
          Use <code className="bg-slate-800 px-1 py-0.5 rounded text-xs text-blue-300"># Section</code> for labels and <code className="bg-slate-800 px-1 py-0.5 rounded text-xs text-blue-300">## Title</code> for issue titles.
          <br/>
          <span className="text-xs text-slate-500">Note: If you only use # Title (without ##), it will create issues without section labels.</span>
        </p>
      </div>

      {/* Input Selection Tabs */}
      {parsedIssues.length === 0 && (
        <div>
          <div className="flex border-b border-slate-700 mb-6">
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
              Upload File
            </button>
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
              Paste Markdown
            </button>
          </div>

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
                accept=".md,.txt" 
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <Upload className="w-16 h-16 text-slate-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Drop Markdown plan here</h3>
              <p className="text-slate-400">or click to browse files</p>
            </div>
          )}

          {/* Text Input Zone */}
          {inputMode === 'text' && (
            <div className="bg-surface border border-slate-700 rounded-xl p-6">
               <textarea 
                 value={textInput}
                 onChange={(e) => setTextInput(e.target.value)}
                 placeholder={`# Feature Group A\n\n## Issue Title 1\nDescription for issue 1...\n\n## Issue Title 2\nDescription for issue 2...`}
                 className="w-full h-64 bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-200 font-mono text-sm focus:border-primary focus:outline-none resize-none"
               />
               <div className="mt-4 flex justify-end">
                 <button 
                   onClick={handleTextParse}
                   disabled={!textInput.trim()}
                   className="bg-primary hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
                 >
                   <Play className="w-4 h-4 fill-current" /> Parse & Preview
                 </button>
               </div>
            </div>
          )}
        </div>
      )}

      {/* Preview & Action Area */}
      {parsedIssues.length > 0 && (
        <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center sticky top-0 z-10">
            <div className="flex items-center gap-4">
               <h3 className="font-semibold text-white">Parsed Issues ({parsedIssues.length})</h3>
               <button 
                 onClick={() => { setParsedIssues([]); setTextInput(''); }}
                 className="text-xs text-slate-400 hover:text-white underline"
               >
                 Clear / Start Over
               </button>
            </div>
            
            <button
              onClick={executeBatch}
              disabled={isProcessing || !token}
              className={clsx(
                "flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all",
                isProcessing 
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed" 
                  : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20"
              )}
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {isProcessing ? 'Dispatching...' : 'Dispatch Issues Now'}
            </button>
          </div>

          <div className="divide-y divide-slate-700 max-h-[600px] overflow-y-auto">
            {parsedIssues.map((issue, idx) => (
              <div key={issue.id} className={clsx("p-4 transition-colors flex gap-4 group", issue.selected ? "bg-slate-800/20" : "opacity-50")}>
                <div className="pt-1">
                   {issue.status === 'idle' && (
                     <input 
                        type="checkbox" 
                        checked={issue.selected} 
                        onChange={() => toggleIssue(issue.id)}
                        className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-primary focus:ring-offset-0 focus:ring-0 cursor-pointer"
                     />
                   )}
                   {issue.status === 'creating' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
                   {issue.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                   {issue.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                     <h4 className="text-white font-medium truncate pr-4">{issue.title}</h4>
                     {issue.status === 'idle' && (
                       <button onClick={() => removeIssue(issue.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                         <X className="w-4 h-4" />
                       </button>
                     )}
                  </div>
                  
                  {/* Labels */}
                  {issue.labels.length > 0 && (
                    <div className="flex gap-2 mt-1">
                      {issue.labels.map((l, i) => (
                        <span key={i} className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/20">
                          {l}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Body Preview */}
                  <p className="text-sm text-slate-400 mt-2 line-clamp-2 font-mono bg-slate-900/50 p-2 rounded">
                    {issue.body || <span className="italic opacity-50">No description provided</span>}
                  </p>

                  {/* Error Message */}
                  {issue.status === 'error' && (
                    <p className="text-xs text-red-400 mt-1">{issue.errorMsg}</p>
                  )}
                  {issue.status === 'success' && (
                    <p className="text-xs text-green-400 mt-1">Issue created successfully</p>
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
