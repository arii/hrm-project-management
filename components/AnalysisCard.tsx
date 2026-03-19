
import React, { useState } from 'react';
import { AnalysisStatus } from '../types';
import { Bot, Loader2, RefreshCw, Copy, Download, Check } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface AnalysisCardProps {
  title: string;
  status: AnalysisStatus;
  result: string | null;
  onAnalyze: () => void;
  description: string;
  repoName?: string;
  disabled?: boolean;
}

const AnalysisCard: React.FC<AnalysisCardProps> = ({ title, status, result, onAnalyze, description, repoName, disabled }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden shadow-lg mb-6">
      <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
        <div>
          <h3 className="text-xl font-semibold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            {title}
          </h3>
          <p className="text-sm text-secondary mt-1">{description}</p>
        </div>
        <button
          onClick={onAnalyze}
          disabled={status === AnalysisStatus.LOADING || disabled}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            (status === AnalysisStatus.LOADING || disabled)
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-primary hover:bg-blue-600 text-white shadow-md shadow-blue-500/20"
          )}
        >
          {status === AnalysisStatus.LOADING ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Run Analysis
            </>
          )}
        </button>
      </div>
      
      <div className="p-6">
        {status === AnalysisStatus.IDLE && !result && (
          <div className="text-center py-12 text-slate-500 bg-slate-900/50 rounded-lg border border-dashed border-slate-700">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Ready to analyze repository data.</p>
            <p className="text-sm">Click "Run Analysis" to generate insights with Gemini 2.5 Flash.</p>
          </div>
        )}

        {status === AnalysisStatus.ERROR && (
           <div className="p-4 bg-red-900/20 border border-red-800 text-red-200 rounded-lg">
             Error running analysis. Please check your API keys and try again.
           </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden">
               {/* Toolbar */}
               <div className="flex justify-between items-center px-4 py-2 bg-slate-800/50 border-b border-slate-700">
                  <span className="text-xs text-slate-500 font-mono uppercase">Markdown Output</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleCopy} 
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                      title="Copy to Clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={handleDownload} 
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                      title="Download as Markdown"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
               </div>

               <div className="p-6">
                  <div className="prose prose-invert prose-base max-w-none prose-blue 
                    prose-headings:text-white prose-headings:font-bold
                    prose-p:text-slate-300 prose-p:leading-relaxed
                    prose-strong:text-white
                    prose-code:text-blue-300 prose-code:bg-blue-900/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800
                    prose-li:text-slate-300">
                    <ReactMarkdown>{result}</ReactMarkdown>
                  </div>
               </div>
            </div>
            <div className="flex justify-end">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Generated by Gemini 2.5 Flash</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisCard;