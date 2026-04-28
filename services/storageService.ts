
import { ModelTier } from '../types';

/**
 * Centralized Storage Service for RepoAuditor AI.
 * Handles persistence, standardized caching with TTL, and quota management.
 */

const APP_PREFIX = 'repo_auditor_';

export const StorageKeys = {
  SETTINGS: `${APP_PREFIX}settings`,
  TECH_AUDIT: `${APP_PREFIX}tech_audit_v4`,
  REVIEWED_SHAS: `${APP_PREFIX}reviewed_shas`,
  GITHUB_CACHE: `${APP_PREFIX}gh_cache`,
  JULES_CACHE: `${APP_PREFIX}jules_cache`,
  JULES_SESSIONS: `${APP_PREFIX}jules_sessions`,
  TELEMETRY: `${APP_PREFIX}telemetry`,
  PR_REVIEWS: `${APP_PREFIX}pr_review_`, // Prefix for individual PR reviews
  ANALYSIS_PREFIX: `${APP_PREFIX}analysis_`, // For useGeminiAnalysis persistence
  CODE_REVIEW_STATE: `${APP_PREFIX}code_review_state`,
};

export interface AppSettings {
  repoName: string;
  githubToken: string;
  julesApiKey: string;
  julesSourceId?: string; // Optional manual override
  geminiApiKey: string;
  defaultModelTier: ModelTier;
  theme?: 'dark' | 'light';
}

const DEFAULT_SETTINGS: AppSettings = {
  repoName: '',
  githubToken: (process.env as any).GITHUB_TOKEN || '',
  julesApiKey: (process.env as any).JULES_API_KEY || '',
  julesSourceId: '',
  geminiApiKey: (process.env as any).GEMINI_API_KEY || (process.env as any).API_KEY || '',
  defaultModelTier: ModelTier.LITE,
};

interface CacheEntry<T> {
  timestamp: number;
  data: T;
  ttl: number;
}

export const storage = {
  getRaw<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue;
      return JSON.parse(item);
    } catch (e) {
      console.warn(`[Storage] Error reading key "${key}":`, e);
      return defaultValue;
    }
  },

  set<T>(key: string, value: T): boolean {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
      return true;
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)) {
        const usage = this.getSpaceUsage();
        console.warn(`[Storage] Quota exceeded (Usage: ${Math.round(usage.total / 1024)}KB). Attempting recovery for "${key}" (${Math.round(serialized.length / 1024)}KB)...`, usage.usageByPrefix);
        
        // 1. Clear expired cache first
        this.clearExpired();
        
        // 2. Try to scavenge large and old items
        this.scavenge(serialized.length);
        
        try {
          localStorage.setItem(key, serialized);
          return true;
        } catch (retryError) {
          // Final attempt: clear all non-essential data
          console.warn('[Storage] Quota still exceeded. Evicting ALL transient and semi-persistent data...');
          this.clearCaches(true); // Now truly aggressive
          
          try {
            localStorage.setItem(key, serialized);
            return true;
          } catch (finalError) {
            console.error('[Storage] Critical storage failure: LocalStorage is full and could not be cleared sufficiently. Total usage:', this.getSpaceUsage());
            // Last resort: clear EVERYTHING except settings
            this.emergencyReset();
            try {
              localStorage.setItem(key, serialized);
              return true;
            } catch (totalFailure) {
              return false;
            }
          }
        }
      }
      return false;
    }
  },

  getSpaceUsage() {
    let total = 0;
    const usageByPrefix: Record<string, number> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        const size = (key.length + val.length) * 2; // UTF-16 characters take 2 bytes
        total += size;
        
        const prefix = key.startsWith(APP_PREFIX) ? key.substring(0, APP_PREFIX.length + 15) : 'other';
        usageByPrefix[prefix] = (usageByPrefix[prefix] || 0) + size;
      }
    } catch (e) {}
    return { total, usageByPrefix };
  },

  emergencyReset(): void {
    console.warn('[Storage] EMERGENCY RESET: Clearing all application data except settings.');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(APP_PREFIX) && key !== StorageKeys.SETTINGS) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  },

  /**
   * Clears only items that have explicitly expired TTL
   */
  clearExpired(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(APP_PREFIX)) {
            try {
                const item = localStorage.getItem(key);
                if (item) {
                    const parsed = JSON.parse(item);
                    if (parsed && typeof parsed === 'object' && 'timestamp' in parsed && 'ttl' in parsed) {
                        if (Date.now() - parsed.timestamp > parsed.ttl) {
                            keysToRemove.push(key);
                        }
                    }
                }
            } catch (e) {
                // ignore parsing errors for non-cache objects
            }
        }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  },

  /**
   * Removes items based on age (LRU) until space is freed or target size attained.
   * @param targetSpace Estimate of bytes needed
   */
  scavenge(targetSpace: number): void {
    const candidates: { key: string, size: number, timestamp: number }[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(APP_PREFIX)) continue;
      
      // Never scavenge absolute keep keys
      if (key === StorageKeys.SETTINGS || key.startsWith(StorageKeys.REVIEWED_SHAS)) continue;
      
      const value = localStorage.getItem(key) || '';
      let timestamp = Date.now();
      
      try {
        const parsed = JSON.parse(value);
        if (parsed.timestamp) timestamp = parsed.timestamp;
      } catch (e) {}

      candidates.push({ key, size: value.length, timestamp });
    }

    // Sort by oldest first
    candidates.sort((a, b) => a.timestamp - b.timestamp);

    let freed = 0;
    for (const cand of candidates) {
      if (freed >= targetSpace) break;
      localStorage.removeItem(cand.key);
      freed += cand.size;
    }
  },

  /**
   * Standardized cache getter with TTL check
   */
  get<T>(key: string): T | null {
    const entry = this.getRaw(key, null as CacheEntry<T> | null);
    if (!entry) return null;
    
    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.remove(key);
      return null;
    }
    return entry.data;
  },

  /**
   * SHA-aware cache getter.
   * If the cached data has a head.sha that doesn't match the provided sha, it's considered invalid.
   */
  getCachedBySha<T>(key: string, sha: string): T | null {
    const entry = this.getRaw(key, null as CacheEntry<T> | null);
    if (!entry) return null;

    const data = entry.data as any;
    const cachedSha = data?.head?.sha;

    if (cachedSha && cachedSha !== sha) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.remove(key);
      return null;
    }
    return entry.data;
  },

  /**
   * Standardized cache setter with TTL (defaults to 15 mins)
   */
  setCached<T>(key: string, data: T, ttl: number = 15 * 60 * 1000): void {
    this.set(key, {
      timestamp: Date.now(),
      data,
      ttl
    });
  },

  remove(key: string): void {
    localStorage.removeItem(key);
  },

  /**
   * Clears app-prefixed storage.
   * @param aggressive If true, even persistent reviews and analysis data are cleared.
   */
  clearCaches(aggressive = false): void {
    const keysToRemove: string[] = [];
    const absoluteKeep = [StorageKeys.SETTINGS, StorageKeys.REVIEWED_SHAS];
    
    // Items that are always safe to clear
    const transientKeys = [StorageKeys.GITHUB_CACHE, StorageKeys.JULES_CACHE, StorageKeys.TELEMETRY];
    
    // Items that are cleared only in aggressive mode or manual clear
    const semiPersistentKeys = [StorageKeys.PR_REVIEWS, StorageKeys.ANALYSIS_PREFIX];

    const isAbsoluteKeep = (key: string) => 
      absoluteKeep.some(k => key === k || key.startsWith(StorageKeys.REVIEWED_SHAS));
    
    const isTransient = (key: string) => 
      transientKeys.some(tk => key.startsWith(tk) || key.includes('_cache'));

    const isSemiPersistent = (key: string) =>
      semiPersistentKeys.some(sk => key.startsWith(sk));

    // Collect keys first
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(APP_PREFIX)) continue;
      
      if (isAbsoluteKeep(key)) continue;

      if (aggressive) {
        keysToRemove.push(key);
      } else {
        if (isTransient(key) || isSemiPersistent(key)) {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(k => localStorage.removeItem(k));
  },

  savePrReview(repo: string, prNumber: number, review: any): void {
    const normalizedRepo = repo.toLowerCase().trim().replace(/^\/+|\/+$/g, '');
    const key = `${StorageKeys.PR_REVIEWS}${normalizedRepo}_${prNumber}`;
    this.set(key, {
      ...review,
      timestamp: Date.now()
    });
  },

  getPrReview(repo: string, prNumber: number): any | null {
    const normalizedRepo = repo.toLowerCase().trim().replace(/^\/+|\/+$/g, '');
    const key = `${StorageKeys.PR_REVIEWS}${normalizedRepo}_${prNumber}`;
    return this.getRaw(key, null);
  },

  saveReviewedShas(repo: string, shas: Record<number, string>): void {
    const normalizedRepo = repo.toLowerCase().trim().replace(/^\/+|\/+$/g, '');
    this.set(`${StorageKeys.REVIEWED_SHAS}_${normalizedRepo}`, shas);
  },

  getReviewedShas(repo: string): Record<number, string> {
    const normalizedRepo = repo.toLowerCase().trim().replace(/^\/+|\/+$/g, '');
    return this.getRaw(`${StorageKeys.REVIEWED_SHAS}_${normalizedRepo}`, {});
  },

  getSettingsKey(): string {
    return StorageKeys.SETTINGS;
  },

  saveJulesSessions(sessions: any[]): void {
    this.setCached(StorageKeys.JULES_SESSIONS, sessions, 2 * 60 * 60 * 1000); // 2 hours cache for sessions
  },

  getJulesSessions(): any[] | null {
    return this.get(StorageKeys.JULES_SESSIONS);
  },

  getSettings(): AppSettings {
    const stored = this.getRaw(StorageKeys.SETTINGS, DEFAULT_SETTINGS);
    
    // Merge with defaults but prioritize environment variables if stored values are empty strings
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      // If stored values are empty strings, fallback to environment defaults
      githubToken: stored.githubToken || DEFAULT_SETTINGS.githubToken,
      julesApiKey: stored.julesApiKey || DEFAULT_SETTINGS.julesApiKey,
      julesSourceId: stored.julesSourceId || DEFAULT_SETTINGS.julesSourceId,
      geminiApiKey: stored.geminiApiKey || DEFAULT_SETTINGS.geminiApiKey,
    };
    
    // Migration helper for older individual keys if they exist
    const legacyRepo = localStorage.getItem('audit_repo_name');
    const legacyToken = localStorage.getItem('audit_gh_token');
    const legacyJules = localStorage.getItem('audit_jules_key');

    if (legacyRepo || legacyToken || legacyJules) {
      const migrated = {
        ...settings,
        repoName: legacyRepo || settings.repoName,
        githubToken: legacyToken || settings.githubToken,
        julesApiKey: legacyJules || settings.julesApiKey,
      };
      this.set(StorageKeys.SETTINGS, migrated);
      localStorage.removeItem('audit_repo_name');
      localStorage.removeItem('audit_gh_token');
      localStorage.removeItem('audit_jules_key');
      return migrated;
    }

    return settings;
  },

  getRepo(): string {
    return this.getSettings().repoName || '';
  },

  getGithubToken(): string {
    return this.getSettings().githubToken || '';
  },

  getGeminiKey(): string {
    return this.getSettings().geminiApiKey || '';
  },

  getModelTier(): ModelTier {
    return this.getSettings().defaultModelTier || ModelTier.FLASH;
  },

  getJulesKey(): string {
    return this.getSettings().julesApiKey || '';
  },

  getJulesSourceId(): string {
    return this.getSettings().julesSourceId || '';
  },

  saveSettings(settings: Partial<AppSettings>): void {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    this.set(StorageKeys.SETTINGS, updated);
    window.dispatchEvent(new CustomEvent('settings_updated', { detail: updated }));
  }
};
