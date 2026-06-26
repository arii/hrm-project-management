
import React, { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, Key, Check, Loader2, Trash2, Download, Upload, Cpu, Zap, Brain, ArrowUpRight, Lock, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { storage, AppSettings } from '../services/storageService';
import { ModelTier, JulesSource } from '../types';
import { listSources } from '../services/julesService';

interface RepoSettingsProps {
  repoName: string;
  setRepoName: (name: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
  julesApiKey: string;
  setJulesApiKey: (key: string) => void;
  julesSourceId: string;
  setJulesSourceId: (id: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  defaultModelTier: ModelTier;
  setDefaultModelTier: (tier: ModelTier) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

const RepoSettings: React.FC<RepoSettingsProps> = ({ 
  repoName, setRepoName, 
  githubToken, setGithubToken,
  julesApiKey, setJulesApiKey,
  julesSourceId, setJulesSourceId,
  geminiApiKey, setGeminiApiKey,
  defaultModelTier, setDefaultModelTier,
  updateSettings
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localRepo, setLocalRepo] = useState(repoName || '');
  const [localToken, setLocalToken] = useState(githubToken || '');
  const [localJulesKey, setLocalJulesKey] = useState(julesApiKey || '');
  const [localJulesSourceId, setLocalJulesSourceId] = useState(julesSourceId || '');
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiApiKey || '');
  
  const [availableSources, setAvailableSources] = useState<JulesSource[]>(() => {
    return storage.getRaw(`repo_auditor_sources_list`, []) as JulesSource[];
  });
  const [loadingSources, setLoadingSources] = useState(false);

  const fetchSources = (key: string) => {
    if (!key) return;
    setLoadingSources(true);
    setErrorMessage(null);

    // Timeout to prevent infinite "Loading sources..."
    const timeout = setTimeout(() => {
      if (loadingSources) {
        setErrorMessage("Loading sources is taking too long. Check your network, API key, or enter the Source ID manually.");
        setLoadingSources(false);
      }
    }, 10000); // 10s

    listSources(key)
      .then(sources => {
        clearTimeout(timeout);
        setAvailableSources(sources);
        storage.set(`repo_auditor_sources_list`, sources);
        if (sources.length === 0) {
          console.warn("[RepoSettings] No Jules sources found.");
        }
      })
      .catch(err => {
        clearTimeout(timeout);
        console.error("[RepoSettings] Failed to fetch sources:", err);
        setErrorMessage(`Failed to load Jules sources: ${err.message || 'Unknown error'}`);
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoadingSources(false);
      });
  };

  // Fetch sources when key changes or modal opens
  useEffect(() => {
    if (isOpen && localJulesKey) {
      fetchSources(localJulesKey);
    }
  }, [isOpen, localJulesKey]);

  // Sync local state with props when the settings modal is opened
  useEffect(() => {
    if (isOpen) {
      setLocalRepo(repoName || '');
      setLocalToken(githubToken || '');
      setLocalJulesKey(julesApiKey || '');
      setLocalJulesSourceId(julesSourceId || '');
      setLocalGeminiKey(geminiApiKey || '');
    }
  }, [isOpen, repoName, githubToken, julesApiKey, julesSourceId, geminiApiKey, defaultModelTier]);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [cacheCleared, setCacheCleared] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);
    setSaveStatus('saving');

    const cleanRepo = localRepo.trim();
    const cleanToken = localToken.trim();
    const cleanJulesKey = localJulesKey.trim();
    const cleanGeminiKey = localGeminiKey.trim();

    if (!cleanRepo) {
      setErrorMessage("Repository Name cannot be empty.");
      setSaveStatus('idle');
      return;
    }

    updateSettings({
      repoName: cleanRepo,
      githubToken: cleanToken,
      julesApiKey: cleanJulesKey,
      julesSourceId: localJulesSourceId.trim(),
      geminiApiKey: cleanGeminiKey,
    });

    setSaveStatus('success');
    setTimeout(() => {
      setSaveStatus('idle');
      setIsOpen(false);
    }, 1000);
  };

  const handleClearCache = () => {
    storage.clearCaches();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 2000);
  };

  const handleExport = () => {
    const settings = storage.getSettings();
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repo-auditor-config-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setImportSuccess(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target?.result as string);
        if (settings.repoName) {
          setLocalRepo(settings.repoName);
          setLocalToken(settings.githubToken || '');
          setLocalJulesKey(settings.julesApiKey || '');
          setLocalGeminiKey(settings.geminiApiKey || '');
          setImportSuccess(true);
          setTimeout(() => setImportSuccess(false), 3000);
        }
      } catch (err) {
        setErrorMessage("Invalid configuration file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="relative z-50">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-slate-700"
      >
        <Settings className="w-6 h-6" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop on mobile and desktop to prevent background click-through and dismiss the modal */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed top-20 left-4 right-4 md:absolute md:top-auto md:left-auto md:right-0 md:mt-2 md:w-96 bg-surface border border-slate-700 rounded-xl shadow-2xl p-6 z-50">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" /> Configuration
            </h2>
          
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {importSuccess && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-xs">
              <Check className="w-4 h-4 shrink-0" />
              <span>Settings loaded. Don't forget to Save.</span>
            </div>
          )}
          
          <div className="max-h-[70vh] overflow-y-auto no-scrollbar pr-1">
            <form onSubmit={handleSave} className="space-y-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 bg-linear-to-b from-slate-900/50 to-slate-950/50 mb-2">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Intelligence</label>
                  <a 
                    href="#/gemini-status" 
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors"
                    onClick={() => setIsOpen(false)}
                  >
                    Manage <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                    {storage.getSettings().geminiModelOverride && storage.getSettings().geminiModelOverride !== 'auto' ? (
                      <Lock className="w-4 h-4 text-amber-400" />
                    ) : (
                      <RotateCcw className="w-4 h-4 text-indigo-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-white">
                      {storage.getSettings().geminiModelOverride && storage.getSettings().geminiModelOverride !== 'auto' 
                        ? storage.getSettings().geminiModelOverride 
                        : "Auto-Selection Mode"}
                    </p>
                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                      {storage.getSettings().geminiModelOverride && storage.getSettings().geminiModelOverride !== 'auto'
                        ? "Pinned model active for all tasks."
                        : "Dynamic rotation based on task load."}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Target Repository</label>
                <input 
                  type="text" 
                  name="repo-name"
                  value={localRepo}
                  autoComplete="username"
                  onChange={(e) => setLocalRepo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                  placeholder="owner/repo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">GitHub Token</label>
                <input 
                  type="password" 
                  name="github-token"
                  value={localToken}
                  autoComplete="current-password"
                  onChange={(e) => setLocalToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                  placeholder="ghp_..."
                />
              </div>

              <div className="border-t border-slate-700 pt-4">
                <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center gap-2">
                  Gemini API Key <span className="text-[10px] text-slate-500 font-normal">(Optional if env set)</span>
                </label>
                <input 
                  type="password" 
                  name="gemini-key"
                  value={localGeminiKey}
                  autoComplete="new-password"
                  onChange={(e) => setLocalGeminiKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  placeholder="AI Key..."
                />
              </div>

              <div className="border-t border-slate-700 pt-4">
                <label className="block text-sm font-medium text-slate-400 mb-1">Jules API Key</label>
                <input 
                  type="password" 
                  name="jules-key"
                  value={localJulesKey}
                  autoComplete="new-password"
                  onChange={(e) => setLocalJulesKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  placeholder="Key..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center justify-between gap-2">
                  <span>Jules Source ID</span>
                  <div className="flex items-center gap-2">
                    <button 
                      type="button" 
                      onClick={() => fetchSources(localJulesKey)}
                      disabled={loadingSources || !localJulesKey}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCcw className={clsx("w-3 h-3", loadingSources && "animate-spin")} />
                      Refresh List
                    </button>
                    <span className="text-[10px] text-slate-500 font-normal italic">(Manual Override)</span>
                  </div>
                </label>
                
                {localJulesKey ? (
                  <div className="space-y-2">
                    <select 
                      value={localJulesSourceId}
                      onChange={(e) => setLocalJulesSourceId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="">-- Let AI Detect Automatically --</option>
                      {availableSources.map(s => (
                        <option key={s.name} value={s.name}>
                          {s.displayName || s.name.split('/').pop()} ({s.name})
                        </option>
                      ))}
                    </select>
                    
                    {loadingSources && (
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading sources...
                      </div>
                    )}
                    
                    {!loadingSources && availableSources.length === 0 && (
                      <p className="text-[9px] text-amber-500/80">No sources found for this API key. Verify repo is indexed in Jules.</p>
                    )}
                  </div>
                ) : (
                  <input 
                    type="text" 
                    value={localJulesSourceId}
                    onChange={(e) => setLocalJulesSourceId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                    placeholder="sources/my-custom-id"
                  />
                )}
                
                <p className="text-[9px] text-slate-500 mt-1 italic">
                  Crucial for repository-agnostic deployments. Explicitly bind this instance to a Jules source.
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[10px] text-blue-300 leading-relaxed">
                <p><strong>Agnostic Design:</strong> RepoAuditor is project-independent. All analysis context is derived dynamically from your current repository configuration.</p>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button 
                  type="submit"
                  disabled={saveStatus !== 'idle'}
                  className={clsx(
                    "w-full font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all",
                    saveStatus === 'success' ? "bg-green-600 text-white" : "bg-primary hover:bg-blue-600 text-white"
                  )}
                >
                  {saveStatus === 'idle' && <><Save className="w-4 h-4" /> Save Settings</>}
                  {saveStatus === 'saving' && <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>}
                  {saveStatus === 'success' && <><Check className="w-4 h-4" /> Saved!</>}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button 
                    type="button"
                    onClick={handleClearCache}
                    className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-2"
                  >
                    {cacheCleared ? <><Check className="w-3 h-3 text-green-500" /> Done</> : <><Trash2 className="w-3 h-3" /> Clear Cache</>}
                  </button>
                  <button 
                    type="button"
                    onClick={handleExport}
                    className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-2"
                  >
                    <Download className="w-3 h-3" /> Export
                  </button>
                </div>

                <label className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors">
                  <Upload className="w-3 h-3" /> Import Config
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
              </div>
            </form>
          </div>
        </div>
        </>
      )}
    </div>
  );
};

export default RepoSettings;
