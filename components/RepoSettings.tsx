
import React, { useState } from 'react';
import { Settings, Save, AlertCircle, Key, Check, Loader2, Trash2, Download, Upload } from 'lucide-react';
import clsx from 'clsx';
import { storage } from '../services/storageService';

interface RepoSettingsProps {
  repoName: string;
  setRepoName: (name: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
  julesApiKey: string;
  setJulesApiKey: (key: string) => void;
}

const RepoSettings: React.FC<RepoSettingsProps> = ({ 
  repoName, setRepoName, 
  githubToken, setGithubToken,
  julesApiKey, setJulesApiKey
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localRepo, setLocalRepo] = useState(repoName);
  const [localToken, setLocalToken] = useState(githubToken);
  const [localJulesKey, setLocalJulesKey] = useState(julesApiKey);
  
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [cacheCleared, setCacheCleared] = useState(false);

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveStatus('saving');

    const cleanRepo = localRepo.trim();
    const cleanToken = localToken.trim();
    const cleanJulesKey = localJulesKey.trim();

    if (!cleanRepo) {
      alert("Repository Name cannot be empty.");
      setSaveStatus('idle');
      return;
    }

    setRepoName(cleanRepo);
    setGithubToken(cleanToken);
    setJulesApiKey(cleanJulesKey);

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

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target?.result as string);
        if (settings.repoName) {
          setLocalRepo(settings.repoName);
          setLocalToken(settings.githubToken || '');
          setLocalJulesKey(settings.julesApiKey || '');
          alert("Settings loaded. Don't forget to Save.");
        }
      } catch (err) {
        alert("Invalid configuration file.");
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
        <div className="absolute right-0 mt-2 w-96 bg-surface border border-slate-700 rounded-xl shadow-2xl p-6">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5" /> Configuration
          </h2>
          
          <form onSubmit={handleSave} className="space-y-4">
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
      )}
    </div>
  );
};

export default RepoSettings;
