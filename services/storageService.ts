
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
  TELEMETRY: `${APP_PREFIX}telemetry`,
  PR_REVIEWS: `${APP_PREFIX}pr_reviews`,
  ANALYSIS_PREFIX: `${APP_PREFIX}analysis_`, // For useGeminiAnalysis persistence
};

export interface AppSettings {
  repoName: string;
  githubToken: string;
  julesApiKey: string;
  theme?: 'dark' | 'light';
}

const DEFAULT_SETTINGS: AppSettings = {
  repoName: 'arii/hrm',
  githubToken: (process.env as any).GITHUB_TOKEN || '',
  julesApiKey: '',
};

interface CacheEntry<T> {
  timestamp: number;
  data: T;
  ttl: number;
}

export const storage = {
  get<T>(key: string, defaultValue: T): T {
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn('[Storage] Quota exceeded. Performing emergency cache eviction...');
        // First try: Clear temporary caches (GitHub, Jules, Telemetry)
        this.clearCaches(false);
        
        try {
          localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (retryError) {
          // Second try: Clear everything except Settings and Reviewed SHAs
          console.warn('[Storage] Quota still exceeded. Evicting PR Reviews and Analysis persistence...');
          this.clearCaches(true);
          try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
          } catch (finalError) {
            console.error('[Storage] Critical storage failure: LocalStorage is full and could not be cleared sufficiently.');
            return false;
          }
        }
      }
      return false;
    }
  },

  /**
   * Standardized cache getter with TTL check
   */
  getCached<T>(key: string): T | null {
    const entry = this.get(key, null as CacheEntry<T> | null);
    if (!entry) return null;
    
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
    const temporaryKeys = [StorageKeys.GITHUB_CACHE, StorageKeys.JULES_CACHE, StorageKeys.TELEMETRY];

    // Collect keys first to avoid index shifting bugs during forward iteration
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const isAppKey = key.startsWith(APP_PREFIX) || key.startsWith('repo_auditor_') || key.startsWith('audit_');
      
      if (isAppKey) {
        if (aggressive) {
          // In aggressive mode, remove everything except the settings and the SHA list
          if (!absoluteKeep.includes(key)) {
            keysToRemove.push(key);
          }
        } else {
          // In normal mode, only remove known transient caches
          const isTransient = temporaryKeys.some(tk => key.startsWith(tk)) || key.includes('_cache');
          if (isTransient) {
            keysToRemove.push(key);
          }
        }
      }
    }

    keysToRemove.forEach(k => localStorage.removeItem(k));
  },

  savePrReview(repo: string, prNumber: number, review: any): void {
    const reviews = this.get(StorageKeys.PR_REVIEWS, {} as Record<string, any>);
    reviews[`${repo}_${prNumber}`] = {
      ...review,
      timestamp: Date.now()
    };
    this.set(StorageKeys.PR_REVIEWS, reviews);
  },

  getPrReview(repo: string, prNumber: number): any | null {
    const reviews = this.get(StorageKeys.PR_REVIEWS, {} as Record<string, any>);
    return reviews[`${repo}_${prNumber}`] || null;
  },

  getSettingsKey(): string {
    return StorageKeys.SETTINGS;
  },

  getSettings(): AppSettings {
    const settings = this.get(StorageKeys.SETTINGS, DEFAULT_SETTINGS);
    
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

  saveSettings(settings: Partial<AppSettings>): void {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    this.set(StorageKeys.SETTINGS, updated);
    window.dispatchEvent(new CustomEvent('settings_updated', { detail: updated }));
  }
};
