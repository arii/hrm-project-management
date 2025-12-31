
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Issues from './pages/Issues';
import PullRequests from './pages/PullRequests';
import Cleanup from './pages/Cleanup';
import BatchCreate from './pages/BatchCreate';
import Agent from './pages/Agent';
import JulesSessions from './pages/JulesSessions';
import CodeReview from './pages/CodeReview';
import TechnicalAudit from './pages/TechnicalAudit';
import WorkflowHealth from './pages/WorkflowHealth';
import { MaintenanceProvider } from './contexts/MaintenanceContext';
import { storage, AppSettings } from './services/storageService';

const App: React.FC = () => {
  const [settings, setSettingsState] = useState<AppSettings>(() => storage.getSettings());

  // Synchronize settings across tabs and components
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storage.getSettingsKey() || e.key?.includes('settings')) {
        setSettingsState(storage.getSettings());
      }
    };

    const handleCustomChange = (e: any) => {
      if (e.detail) setSettingsState(e.detail);
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

  const { repoName, githubToken, julesApiKey } = settings;

  return (
    <MaintenanceProvider repoName={repoName} token={githubToken}>
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
            />
          }>
            <Route index element={<Dashboard repoName={repoName} token={githubToken} />} />
            <Route path="audit" element={<TechnicalAudit repoName={repoName} token={githubToken} />} />
            <Route path="workflow-health" element={<WorkflowHealth repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="issues" element={<Issues repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="pull-requests" element={<PullRequests repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="code-review" element={<CodeReview repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="agent" element={<Agent repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="cleanup" element={<Cleanup repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
            <Route path="batch-create" element={<BatchCreate repoName={repoName} token={githubToken} />} />
            <Route path="sessions" element={<JulesSessions repoName={repoName} julesApiKey={julesApiKey} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </MaintenanceProvider>
  );
};

export default App;
