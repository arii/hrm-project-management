
import React, { useState } from 'react';
import { Settings, Save, AlertCircle, Key, Check, Loader2 } from 'lucide-react';
import clsx from 'clsx';

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

  const handleSave = () => {
    setSaveStatus('saving');

    const cleanRepo = localRepo.trim();
    const cleanToken = localToken.trim();
    const cleanJulesKey = localJulesKey.trim();

    console.log('[Settings] Attempting to save:', {
      repo: cleanRepo,
      hasGithubToken: !!cleanToken,
      hasJulesKey: !!cleanJulesKey,
      julesKeyLength: cleanJulesKey.length
    });

    if (!cleanRepo) {
      alert("Repository Name cannot be empty.");
      setSaveStatus('idle');
      return;
    }

    // Persist
    setRepoName(cleanRepo);
    setGithubToken(cleanToken);
    setJulesApiKey(cleanJulesKey);

    // Show success feedback
    setSaveStatus('success');
    
    setTimeout(() => {
      setSaveStatus('idle');
      setIsOpen(false);
    }, 1000);
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
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Target Repository (owner/repo)</label>
              <input 
                type="text" 
                value={localRepo}
                onChange={(e) => setLocalRepo(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                placeholder="arii/hrm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">GitHub Personal Access Token</label>
              <input 
                type="password" 
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                placeholder="ghp_..."
              />
              <p className="text-xs text-slate-500 mt-2 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Required for rate limits/private repos.
              </p>
            </div>

            <div className="border-t border-slate-700 pt-4">
              <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center gap-2">
                 <Key className="w-3 h-3" /> Jules API Key
              </label>
              <input 
                type="password" 
                value={localJulesKey}
                onChange={(e) => setLocalJulesKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                placeholder="Paste your API key here..."
              />
              <p className="text-xs text-slate-500 mt-2">
                Required for Jules Sessions integration.
              </p>
            </div>

            <button 
              onClick={handleSave}
              disabled={saveStatus !== 'idle'}
              className={clsx(
                "w-full font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all mt-2",
                saveStatus === 'success' 
                  ? "bg-green-600 text-white" 
                  : "bg-primary hover:bg-blue-600 text-white"
              )}
            >
              {saveStatus === 'idle' && <><Save className="w-4 h-4" /> Save Settings</>}
              {saveStatus === 'saving' && <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>}
              {saveStatus === 'success' && <><Check className="w-4 h-4" /> Saved!</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepoSettings;
