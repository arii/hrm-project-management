
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { analyzeIssueRedundancy, analyzePullRequests, generateCleanupReport } from '../services/geminiService';
import { prefetchRepositoryData } from '../services/githubService';

interface MaintenanceResults {
  issues?: any;
  prs?: any;
  cleanup?: any;
  timestamp?: number;
}

interface MaintenanceContextType {
  results: MaintenanceResults | null;
  isRunning: boolean;
  step: string;
  runMaintenance: () => Promise<void>;
  clearResults: () => void;
}

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(undefined);

export const useMaintenance = () => {
  const context = useContext(MaintenanceContext);
  if (!context) throw new Error("useMaintenance must be used within a MaintenanceProvider");
  return context;
};

interface MaintenanceProviderProps {
  children: ReactNode;
  repoName: string;
  token: string;
}

export const MaintenanceProvider: React.FC<MaintenanceProviderProps> = ({ children, repoName, token }) => {
  const [results, setResults] = useState<MaintenanceResults | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState('');

  const STORAGE_KEY = `audit_daily_maintenance_${repoName}`;

  useEffect(() => {
    // 1. Load from cache
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        setResults(JSON.parse(stored));
      } else {
        setResults(null);
        // 2. Preemptively run if cache is empty and we have credentials
        if (repoName && token) {
           runMaintenance(true);
        }
      }
    } catch (e) {
      console.warn("Maintenance storage error", e);
    }
  }, [repoName]);

  const runMaintenance = async (isBackground = false) => {
    if (!token) return;
    
    // If background run, check if we already have fresh results (e.g. from another tab or persistent storage reload)
    if (isBackground && results) return;

    setIsRunning(true);
    setStep('Initializing...');
    
    try {
      // Step 0: Prefetch Data
      setStep('Fetching GitHub Data...');
      const { issues, prs, closedPrs } = await prefetchRepositoryData(repoName, token);

      if (issues.length === 0 && prs.length === 0) {
         if (!isBackground) alert("No data found in repository.");
         setIsRunning(false);
         setStep('');
         return;
      }

      // Step 1: Issue Analysis
      setStep('Analyzing Issue Backlog...');
      const issueRes = await analyzeIssueRedundancy(issues);
      
      // Step 2: PR Health
      setStep('Checking PR Health...');
      const prRes = await analyzePullRequests(prs);

      // Step 3: Cleanup
      setStep('Generating Cleanup Report...');
      const cleanupRes = await generateCleanupReport(issues, closedPrs);

      const newResults = {
        issues: issueRes,
        prs: prRes,
        cleanup: cleanupRes,
        timestamp: Date.now()
      };

      setResults(newResults);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newResults));

    } catch (e: any) {
      console.error("Maintenance run failed:", e);
      if (!isBackground) alert("Maintenance run failed: " + e.message);
    } finally {
      setIsRunning(false);
      setStep('');
    }
  };

  const clearResults = () => {
    setResults(null);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <MaintenanceContext.Provider value={{ results, isRunning, step, runMaintenance, clearResults }}>
      {children}
    </MaintenanceContext.Provider>
  );
};
