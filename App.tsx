
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import PullRequests from './pages/PullRequests';
import BatchCreate from './pages/BatchCreate';
import CodeReview from './pages/CodeReview';
import WorkflowHealth from './pages/WorkflowHealth';
import JulesManagement from './pages/JulesManagement';
import { storage, AppSettings } from './services/storageService';
import { setGeminiApiKey } from './services/geminiService';

const App: React.FC = () => {
  const [settings, setSettingsState] = useState<AppSettings>(() => {
    const s = storage.getSettings();
    if (s.geminiApiKey) setGeminiApiKey(s.geminiApiKey);
    return s;
  });

  // Synchronize settings across tabs and components
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storage.getSettingsKey() || e.key?.includes('settings')) {
        const s = storage.getSettings();
        setSettingsState(s);
        if (s.geminiApiKey) setGeminiApiKey(s.geminiApiKey);
      }
    };

    const handleCustomChange = (e: any) => {
      if (e.detail) {
        setSettingsState(e.detail);
        if (e.detail.geminiApiKey) setGeminiApiKey(e.detail.geminiApiKey);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('settings_updated', handleCustomChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('settings_updated', handleCustomChange);
    };
  }, []);

  const updateSettings = (updates: Partial<AppSettings>) => {
    storage.saveSettings(updates);
    // Local state update is handled by the event listener dispatched in saveSettings
  };

  const { 
    repoName = '', 
    githubToken = '', 
    julesApiKey = '', 
    geminiApiKey = '' 
  } = settings;

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={
          <Layout 
            repoName={repoName} 
            setRepoName={(name) => updateSettings({ repoName: name })}
            githubToken={githubToken}
            setGithubToken={(token) => updateSettings({ githubToken: token })}
            julesApiKey={julesApiKey}
            setJulesApiKey={(key) => updateSettings({ julesApiKey: key })}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={(key) => updateSettings({ geminiApiKey: key })}
          />
        }>
          <Route index element={<Dashboard repoName={repoName} />} />
          <Route path="pull-requests" element={<PullRequests repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="code-review" element={<CodeReview repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="workflow-health" element={<WorkflowHealth repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="batch-create" element={<BatchCreate repoName={repoName} token={githubToken} />} />
          <Route path="jules-management" element={<JulesManagement julesApiKey={julesApiKey} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;
