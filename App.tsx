
import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Issues from './pages/Issues';
import PullRequests from './pages/PullRequests';
import Cleanup from './pages/Cleanup';
import BatchCreate from './pages/BatchCreate';
import Agent from './pages/Agent';

const App: React.FC = () => {
  // Global State for Repo context
  // Initialize from localStorage to persist across reloads
  const [repoName, setRepoNameState] = useState(() => localStorage.getItem('audit_repo_name') || 'arii/hrm');
  const [githubToken, setGithubTokenState] = useState(() => localStorage.getItem('audit_gh_token') || '');

  const setRepoName = (name: string) => {
    setRepoNameState(name);
    localStorage.setItem('audit_repo_name', name);
  };

  const setGithubToken = (token: string) => {
    setGithubTokenState(token);
    localStorage.setItem('audit_gh_token', token);
  };

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={
          <Layout 
            repoName={repoName} 
            setRepoName={setRepoName}
            githubToken={githubToken}
            setGithubToken={setGithubToken}
          />
        }>
          <Route index element={<Dashboard repoName={repoName} token={githubToken} />} />
          <Route path="issues" element={<Issues repoName={repoName} token={githubToken} />} />
          <Route path="pull-requests" element={<PullRequests repoName={repoName} token={githubToken} />} />
          <Route path="agent" element={<Agent repoName={repoName} token={githubToken} />} />
          <Route path="cleanup" element={<Cleanup repoName={repoName} token={githubToken} />} />
          <Route path="batch-create" element={<BatchCreate repoName={repoName} token={githubToken} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;
