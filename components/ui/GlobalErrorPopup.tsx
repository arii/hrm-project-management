
import React, { useState } from 'react';
import { useErrors } from '../../context/ErrorContext';
import { AlertCircle, X, ChevronDown, ChevronUp, Trash2, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';

const GlobalErrorPopup: React.FC = () => {
  const { errors, removeError, clearErrors } = useErrors();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  if (errors.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3 max-w-md w-full pointer-events-none">
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full bg-[#1a0b0b] border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto"
          >
            {/* Header */}
            <div className="p-4 bg-red-950/20 border-b border-red-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span className="font-bold text-sm uppercase tracking-wider">System Errors Detected ({errors.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-red-400"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <button 
                  onClick={clearErrors}
                  className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-red-400"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Error List */}
            {isExpanded && (
              <div className="max-h-[70vh] overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {errors.map((error) => (
                  <div 
                    key={error.id} 
                    className="bg-red-950/10 border border-red-500/10 rounded-xl overflow-hidden"
                  >
                    <div className="p-3 flex items-start gap-3">
                      <div className="mt-0.5">
                        <Terminal className="w-3.5 h-3.5 text-red-500/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-red-200 font-mono break-words line-clamp-3">
                          {error.message}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[9px] text-red-500/50 font-mono">
                            {new Date(error.timestamp).toLocaleTimeString()}
                          </span>
                          {error.stack && (
                            <button 
                              onClick={() => setExpandedErrorId(expandedErrorId === error.id ? null : error.id)}
                              className="text-[9px] font-bold text-red-400 hover:underline uppercase"
                            >
                              {expandedErrorId === error.id ? 'Hide Stack' : 'Show Stack'}
                            </button>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => removeError(error.id)}
                        className="p-1 hover:bg-red-500/20 rounded transition-colors text-red-500/40 hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    {expandedErrorId === error.id && error.stack && (
                      <div className="bg-black/40 p-3 border-t border-red-500/10">
                        <pre className="text-[10px] text-red-400/70 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {error.stack}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Collapsed Preview (Last Error) */}
            {!isExpanded && (
              <div className="p-4 flex items-center justify-between gap-4 group cursor-pointer" onClick={() => setIsExpanded(true)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                  <p className="text-xs text-red-300 font-medium truncate">
                    {errors[errors.length - 1].message}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold text-red-500/50 group-hover:text-red-400 transition-colors uppercase">
                  Details
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GlobalErrorPopup;
