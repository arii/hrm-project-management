import React from 'react';
import { BookOpen } from 'lucide-react';

export default function UserGuide() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 text-slate-300">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold text-white flex items-center gap-3">
          <BookOpen className="w-10 h-10 text-indigo-400" />
          Repo Auditor AI User Guide
        </h1>
        <p className="text-xl text-slate-400">
          DevAI workflow console powered by the LoopMarshal DevAI orchestration engine.
        </p>
      </header>

      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-6">
        <h2 className="text-2xl font-bold text-white">🔒 Security & Client-Side Privacy First</h2>
        <p>Repo Auditor AI operates on a zero-retention architecture:</p>
        <ul className="list-disc list-inside space-y-2 text-slate-400">
          <li>All API keys (GitHub, Gemini, Jules) are stored only inside your local browser storage (localStorage).</li>
          <li>Your tokens are never recorded on our servers or remote databases.</li>
          <li>API requests are negotiated directly from your browser to Google Cloud and GitHub API endpoints.</li>
        </ul>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-6">
        <h2 className="text-2xl font-bold text-white">⚙️ 1. Quick Start: Connecting Your Repository</h2>
        <ol className="list-decimal list-inside space-y-4 text-slate-400">
          <li><strong>Open Settings:</strong> Click the Gear icon in the top right.</li>
          <li><strong>Mount Target Repository:</strong> Input GitHub Owner/Repo (e.g., arii/tech-dancer).</li>
          <li><strong>Configure API Tokens:</strong>
            <ul className="list-disc list-inside ml-6 mt-2">
              <li>Gemini API Key (Get it <a href="https://aistudio.google.com/" className="text-indigo-400 underline" target="_blank">here</a>)</li>
              <li>GitHub PAT (Generate <a href="https://github.com/settings/tokens" className="text-indigo-400 underline" target="_blank">here</a>)</li>
              <li>Jules API Key (Optional)</li>
            </ul>
          </li>
          <li><strong>Save Changes:</strong> Click "Save Configuration".</li>
        </ol>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-6">
        <h2 className="text-2xl font-bold text-white">🤖 2. Navigating the Control Center</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-700">
            <h3 className="font-bold text-white">Code Review (Inner Loop)</h3>
            <p className="text-sm mt-1">Review open PRs, run AI-assisted analysis, and generate structured feedback.</p>
          </div>
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-700">
            <h3 className="font-bold text-white">Workflow Health (Outer Loop)</h3>
            <p className="text-sm mt-1">Audit CI failures, perform Root-Cause Analysis (RCA), and create issues.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
