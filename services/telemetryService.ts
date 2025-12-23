
// Simple local telemetry to track feature usage
const STORAGE_KEY = 'repo_auditor_telemetry';

interface UsageLog {
  [path: string]: number;
}

export const trackPageVisit = (path: string) => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const logs: UsageLog = raw ? JSON.parse(raw) : {};
    
    // Normalize path
    const cleanPath = path.split('?')[0];
    if (cleanPath === '/') return; // Don't track dashboard hits as specific tool usage

    logs[cleanPath] = (logs[cleanPath] || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn('Telemetry write failed', e);
  }
};

export const getTopTools = (): { path: string, count: number }[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const logs: UsageLog = raw ? JSON.parse(raw) : {};
    
    return Object.entries(logs)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count);
  } catch (e) {
    return [];
  }
};

export const getRecommendedWorkflow = () => {
  const top = getTopTools();
  // If user has specific history, return top 3
  if (top.length > 0) return top.slice(0, 3);
  
  // Default fallback based on user preference mentioned in prompt
  return [
    { path: '/code-review', count: 0 },
    { path: '/cleanup', count: 0 },
    { path: '/issues', count: 0 }
  ];
};
