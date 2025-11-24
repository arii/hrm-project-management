
import React, { useState } from 'react';
import { Settings, Save, AlertCircle } from 'lucide-react';

interface RepoSettingsProps {
  repoName: string;
  setRepoName: (name: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
}

const RepoSettings: React.FC<RepoSettingsProps> = ({ repoName, setRepoName, githubToken, setGithubToken }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localRepo, setLocalRepo] = useState(repoName);
  const [localToken, setLocalToken] = useState(githubToken);

  const handleSave = () => {
    setRepoName(localRepo);
    setGithubToken(localToken);
    setIsOpen(false);
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
                Required for higher rate limits and private repos. Saved to your browser's local storage.
              </p>
            </div>

            <button 
              onClick={handleSave}
              className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" /> Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepoSettings;
