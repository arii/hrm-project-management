
import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Issues from './pages/Issues';
import PullRequests from './pages/PullRequests';
import Cleanup from './pages/Cleanup';
import BatchCreate from './pages/BatchCreate';
import Agent from './pages/Agent';
import JulesSessions from './pages/JulesSessions';

const App: React.FC = () => {
  // Global State for Repo context
  // Initialize from localStorage to persist across reloads
  const [repoName, setRepoNameState] = useState(() => localStorage.getItem('audit_repo_name') || 'arii/hrm');
  
  // Securely load from localStorage, defaulting to empty string if not found
  const [githubToken, setGithubTokenState] = useState(() => localStorage.getItem('audit_gh_token') || '');
  const [julesApiKey, setJulesApiKeyState] = useState(() => localStorage.getItem('audit_jules_key') || '');

  const setRepoName = (name: string) => {
    setRepoNameState(name);
    localStorage.setItem('audit_repo_name', name);
  };

  const setGithubToken = (token: string) => {
    setGithubTokenState(token);
    localStorage.setItem('audit_gh_token', token);
  };

  const setJulesApiKey = (key: string) => {
    setJulesApiKeyState(key);
    localStorage.setItem('audit_jules_key', key);
  };

  // Pre-fetch data if credentials exist
  React.useEffect(() => {
    if (repoName && githubToken) {
       // Lazy import to avoid circular dependencies if any, but direct import is fine here
       import('./services/githubService').then(service => {
         service.fetchIssues(repoName, githubToken, 'open').catch(() => {});
         service.fetchPullRequests(repoName, githubToken, 'open').catch(() => {});
         service.fetchBranches(repoName, githubToken).catch(() => {});
       });
    }
  }, [repoName, githubToken]);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={
          <Layout 
            repoName={repoName} 
            setRepoName={setRepoName}
            githubToken={githubToken}
            setGithubToken={setGithubToken}
            julesApiKey={julesApiKey}
            setJulesApiKey={setJulesApiKey}
          />
        }>
          <Route index element={<Dashboard repoName={repoName} token={githubToken} />} />
          <Route path="issues" element={<Issues repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="pull-requests" element={<PullRequests repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="agent" element={<Agent repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="cleanup" element={<Cleanup repoName={repoName} token={githubToken} julesApiKey={julesApiKey} />} />
          <Route path="batch-create" element={<BatchCreate repoName={repoName} token={githubToken} />} />
          <Route path="sessions" element={<JulesSessions repoName={repoName} julesApiKey={julesApiKey} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;