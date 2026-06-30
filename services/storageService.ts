
import { ModelTier, UsageMetrics } from '../types';

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
  EXTRACTED_ISSUES: `${APP_PREFIX}extracted_issues_`, // Prefix for extracted issues per PR
  USAGE: `${APP_PREFIX}usage`,
  MODEL_HEALTH: `${APP_PREFIX}model_health`,
  REPO_SOURCES: `${APP_PREFIX}repo_sources`,
  AUTO_SEND_FIX_ENABLED: `${APP_PREFIX}auto_send_fix_enabled`,
  AUTO_SEND_FIX_LAST_RUN: `${APP_PREFIX}auto_send_fix_last_run`,
  AUTO_HEAL_LOGS: `${APP_PREFIX}auto_heal_logs`,
};

export interface AppSettings {
  repoName: string;
  githubToken: string;
  julesApiKey: string;
  julesSourceId?: string; // Optional manual override
  geminiApiKey: string;
  defaultModelTier: ModelTier;
  geminiModelOverride?: string; // Manual model selection override (specific model name or 'auto')
  theme?: 'dark' | 'light';
  autoSendToJules?: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  repoName: '',
  githubToken: '',
  julesApiKey: '',
  julesSourceId: '',
  geminiApiKey: '',
  defaultModelTier: ModelTier.FLASH,
  geminiModelOverride: 'auto',
  autoSendToJules: false,
};

// Fallback values from environment, using safe access patterns
const ENV_DEFAULTS = {
  githubToken: (typeof process !== 'undefined' && process.env?.GITHUB_TOKEN) || '',
  julesApiKey: (typeof process !== 'undefined' && process.env?.JULES_API_KEY) || '',
  geminiApiKey: (typeof process !== 'undefined' && (process.env?.GEMINI_API_KEY || process.env?.API_KEY)) || '',
};

interface CacheEntry<T> {
  timestamp: number;
  data: T;
  ttl: number;
}

// Memory fallback for environments where LocalStorage is failing or full
const memoryCache: Record<string, string> = {};
// Parsed object cache to avoid repeated JSON parsing
const parsedMemoryCache: Record<string, any> = {};

const MAX_LOCALSTORAGE_ITEM_SIZE = 2 * 1024 * 1024; // 2MB limit for LocalStorage items

const DB_NAME = 'RepoAuditorDB';
const STORE_NAME = 'StorageStore';
let dbInstance: IDBDatabase | null = null;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error("IndexedDB is not available on server."));
      return;
    }
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        dbInstance = request.result;
        resolve(dbInstance);
      };
      request.onerror = (e) => {
        console.warn("[Storage] IndexedDB open error:", e);
        reject(e);
      };
    } catch (err) {
      console.warn("[Storage] IndexedDB not supported:", err);
      reject(err);
    }
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.warn("[Storage] IndexedDB set failed:", err);
  }
};

const idbRemove = async (key: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.warn("[Storage] IndexedDB delete failed:", err);
  }
};

const loadAllFromIDB = async () => {
  try {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const keysRequest = store.getAllKeys();
    
    keysRequest.onsuccess = () => {
      const keys = keysRequest.result;
      // Only load essential items into memory on startup to save memory
      const essentialKeys = [StorageKeys.SETTINGS, StorageKeys.JULES_SESSIONS];
      
      const valuesRequest = store.getAll();
      
      valuesRequest.onsuccess = () => {
        const values = valuesRequest.result;
        
        const processChunk = (startIndex: number) => {
          const chunkSize = 50;
          const endIndex = Math.min(startIndex + chunkSize, keys.length);
          
          for (let i = startIndex; i < endIndex; i++) {
            const kStr = String(keys[i]);
            const vStr = String(values[i]);
            memoryCache[kStr] = vStr;
            
            if (essentialKeys.includes(kStr)) {
              try {
                parsedMemoryCache[kStr] = JSON.parse(vStr);
              } catch (e) {
                console.warn(`[Storage] Failed to pre-parse IndexedDB key ${kStr}`);
              }
            }
          }
          
          if (endIndex < keys.length) {
            setTimeout(() => processChunk(endIndex), 0);
          } else {
            window.dispatchEvent(new CustomEvent('storage_cache_hydrated'));
          }
        };
        
        processChunk(0);
      };
    };
  } catch (err) {
    console.warn("[Storage] IndexedDB preload failed:", err);
  }
};

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  loadAllFromIDB();
}

const normalizeRepo = (repo: string) => repo.toLowerCase().trim().replace(/^\/+|\/+$/g, '');

export const storage = {
  getRaw<T>(key: string, defaultValue: T): T {
    if (parsedMemoryCache[key] !== undefined) {
      return parsedMemoryCache[key] as T;
    }

    let item: string | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        item = localStorage.getItem(key);
      }
    } catch (e) {
      // console.warn(`[Storage] Failed to read "${key}" from localStorage:`, e);
    }

    if (!item) {
      item = memoryCache[key] || null;
    }

    if (!item) return defaultValue;

    try {
      const parsed = JSON.parse(item) as T;
      parsedMemoryCache[key] = parsed;
      return parsed;
    } catch (e) {
      // console.warn(`[Storage] Error parsing key "${key}":`, e);
      return defaultValue;
    }
  },

  set<T>(key: string, value: T): boolean {
    const serialized = JSON.stringify(value);
    const itemSize = serialized.length * 2; // Rough estimate in bytes (UTF-16)
    const itemSizeKb = Math.round(itemSize / 1024);

    // Save to memory cache regardless of LocalStorage status
    memoryCache[key] = serialized;
    parsedMemoryCache[key] = value;

    // Asynchronously write to IndexedDB
    idbSet(key, serialized).catch(e => { /* console.warn(`[Storage] background IndexedDB set failed for ${key}:`, e) */ });

    // Guard against oversized items that will definitely fail or lag LocalStorage
    if (itemSize > MAX_LOCALSTORAGE_ITEM_SIZE) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        }
      } catch (e) {}
      return true; // We consider it success because it's safely stored in IndexedDB and memory
    }

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, serialized);
        return true;
      }
      return true;
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)) {
        const usage = this.getSpaceUsage();
        // console.warn(`[Storage] Quota exceeded (Used: ${Math.round(usage.total / 1024)}KB). Item: "${key}" (${itemSizeKb}KB). Attempting recovery...`, usage.usageByPrefix);
        
        // 1. Clear expired cache first
        this.clearExpired();
        
        // 2. Try to scavenge large and old items
        this.scavenge(itemSize);
        
        try {
          localStorage.setItem(key, serialized);
          return true;
        } catch (retryError) {
          // Final attempt: clear all non-essential data
          // console.warn('[Storage] Quota still exceeded after scavenging. Evicting ALL transient data...');
          this.clearCaches(true);
          
          try {
            localStorage.setItem(key, serialized);
            return true;
          } catch (finalError) {
            // console.warn(`[Storage] LocalStorage is full. Item size: ${itemSizeKb}KB. Falling back to memory & IndexedDB.`);
            
            // Last resort: clear EVERYTHING except settings to make room for future smaller saves
            this.emergencyReset();
            try {
              localStorage.setItem(key, serialized);
              return true;
            } catch (totalFailure) {
              return true; // Return true because it is safely in memoryCache + IndexedDB
            }
          }
        }
      } else {
        // console.warn(`[Storage] Failed to write to localStorage for key "${key}" (not a quota error). Falling back to memory & IndexedDB.`, e);
      }
      return true; // Success fallback through IndexedDB & memory
    }
  },

  getSpaceUsage() {
    let total = 0;
    const usageByPrefix: Record<string, number> = {};
    if (typeof localStorage === 'undefined') {
      return { total, usageByPrefix };
    }
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
    if (typeof localStorage === 'undefined') return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(APP_PREFIX) && key !== StorageKeys.SETTINGS) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => this.remove(k));
  },

  /**
   * Clears only items that have explicitly expired TTL
   */
  clearExpired(): void {
    if (typeof localStorage === 'undefined') return;
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
    keysToRemove.forEach(k => this.remove(k));
  },

  /**
   * Removes items based on age (LRU) until space is freed or target size attained.
   * @param targetSpace Estimate of bytes needed
   */
  scavenge(targetSpace: number): void {
    if (typeof localStorage === 'undefined') return;
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
      this.remove(cand.key);
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
    const entry = this.getRaw(key, null as CacheEntry<any> | null);
    if (!entry) return null;

    const data = entry.data;
    if (!data) return null;

    let cachedSha = data?.head?.sha;
    let actualValue = data;

    // Support both direct objects and objects wrapped in { head: { sha }, data }
    if (!cachedSha && data && typeof data === 'object' && 'head' in data && 'data' in data) {
      cachedSha = (data as any).head?.sha;
      actualValue = (data as any).data;
    }

    if (cachedSha && sha && cachedSha !== sha) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.remove(key);
      return null;
    }
    return actualValue;
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
    delete memoryCache[key];
    delete parsedMemoryCache[key];
    idbRemove(key).catch(e => console.warn(`[Storage] background IndexedDB remove failed for ${key}:`, e));
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },

  /**
   * Clears app-prefixed storage.
   * @param aggressive If true, even persistent reviews and analysis data are cleared.
   */
  clearCaches(aggressive = false): void {
    if (typeof localStorage === 'undefined') return;
    const keysToRemove: string[] = [];
    const absoluteKeep = [StorageKeys.SETTINGS, StorageKeys.REVIEWED_SHAS, StorageKeys.REPO_SOURCES];
    
    // Items that are always safe to clear
    const transientKeys = [StorageKeys.GITHUB_CACHE, StorageKeys.JULES_CACHE, StorageKeys.TELEMETRY];
    
    // Items that are cleared only in aggressive mode or manual clear
    const semiPersistentKeys = [StorageKeys.PR_REVIEWS, StorageKeys.ANALYSIS_PREFIX, StorageKeys.EXTRACTED_ISSUES];

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
        if (isTransient(key)) {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(k => this.remove(k));
  },

  savePrReview(repo: string, prNumber: number, review: any, sha?: string): void {
    const key = `${StorageKeys.PR_REVIEWS}${normalizeRepo(repo)}_${prNumber}`;
    // console.log(`[Storage] Saving review key: ${key}`);
    this.set(key, {
      ...review,
      sha: sha || review.sha,
      timestamp: Date.now()
    });
  },

  getPrReview(repo: string, prNumber: number, currentSha?: string): any | null {
    const key = `${StorageKeys.PR_REVIEWS}${normalizeRepo(repo)}_${prNumber}`;
    const review = this.getRaw(key, null);
    if (!review) {
      // console.log(`[Storage] No review found for key: ${key}`);
      return null;
    }
    
    // Invalidate and remove if currentSha is provided and mismatching
    if (currentSha && review.sha && review.sha !== currentSha) {
      this.remove(key);
      return null;
    }
    return review;
  },

  saveReviewedShas(repo: string, shas: Record<number, string>): void {
    this.set(`${StorageKeys.REVIEWED_SHAS}_${normalizeRepo(repo)}`, shas);
  },

  saveExtractedIssues(repo: string, prNumber: number, issues: any[]): void {
    const key = `${StorageKeys.EXTRACTED_ISSUES}${normalizeRepo(repo)}_${prNumber}`;
    this.set(key, {
      issues,
      timestamp: Date.now()
    });
  },

  getExtractedIssues(repo: string, prNumber: number): any[] {
    const key = `${StorageKeys.EXTRACTED_ISSUES}${normalizeRepo(repo)}_${prNumber}`;
    const data = this.getRaw(key, null as any);
    return data?.issues || [];
  },

  getReviewedShas(repo: string): Record<number, string> {
    return this.getRaw(`${StorageKeys.REVIEWED_SHAS}_${normalizeRepo(repo)}`, {});
  },

  saveWorkflowAudit(repo: string, audit: any): void {
    const key = `${StorageKeys.ANALYSIS_PREFIX}workflow_${normalizeRepo(repo)}`;
    this.set(key, {
      ...audit,
      timestamp: Date.now()
    });
  },

  getWorkflowAudit(repo: string): any | null {
    const key = `${StorageKeys.ANALYSIS_PREFIX}workflow_${normalizeRepo(repo)}`;
    return this.getRaw(key, null);
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

  getUsage(): UsageMetrics {
    return this.getRaw(StorageKeys.USAGE, {
      totalTokens: 0,
      totalRequests: 0,
      lastRequestTokens: 0,
      totalCost: 0,
      timestamp: Date.now()
    });
  },

  trackUsage(tokens: number, tier?: ModelTier): void {
    const current = this.getUsage();
    
    // Average pricing per 1M tokens (conservative averages of input/output rates)
    // Flash: ~$0.15 in / $0.60 out | Pro: ~$3.50 in / $10.50 out
    const TIER_RATES = {
      [ModelTier.LITE]: 0.15 / 1_000_000,
      [ModelTier.FLASH]: 0.35 / 1_000_000,
      [ModelTier.PRO]: 7.00 / 1_000_000,
    };

    const rate = tier ? TIER_RATES[tier] : TIER_RATES[ModelTier.FLASH];
    const estimatedCost = tokens * rate;

    const updated: UsageMetrics = {
      totalTokens: current.totalTokens + tokens,
      totalRequests: current.totalRequests + 1,
      lastRequestTokens: tokens,
      totalCost: (current.totalCost || 0) + estimatedCost,
      timestamp: Date.now()
    };
    this.set(StorageKeys.USAGE, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('usage_updated', { detail: updated }));
    }
  },

  getSettings(): AppSettings {
    const stored = this.getRaw(StorageKeys.SETTINGS, {} as Partial<AppSettings>);
    
    // Merge: DEFAULT_SETTINGS < ENV_DEFAULTS < stored
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      // If we have stored values, they take precedence over everything
      ...stored,
      // Only use ENV_DEFAULTS if the field is empty in BOTH stored and DEFAULT_SETTINGS
      githubToken: stored.githubToken || ENV_DEFAULTS.githubToken || DEFAULT_SETTINGS.githubToken,
      julesApiKey: stored.julesApiKey || ENV_DEFAULTS.julesApiKey || DEFAULT_SETTINGS.julesApiKey,
      geminiApiKey: stored.geminiApiKey || ENV_DEFAULTS.geminiApiKey || DEFAULT_SETTINGS.geminiApiKey,
    };
    
    // Migration helper for older individual keys if they exist
    if (typeof localStorage !== 'undefined') {
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

  getRepoSourceId(repo: string): string | null {
    if (!repo) return null;
    const map = this.getRaw(StorageKeys.REPO_SOURCES, {} as Record<string, string>);
    return map[normalizeRepo(repo)] || null;
  },

  saveRepoSourceId(repo: string, sourceId: string): void {
    if (!repo || !sourceId) return;
    const map = this.getRaw(StorageKeys.REPO_SOURCES, {} as Record<string, string>);
    map[normalizeRepo(repo)] = sourceId;
    this.set(StorageKeys.REPO_SOURCES, map);
  },

  clearRepoSourceId(repo: string): void {
    if (!repo) return;
    const map = this.getRaw(StorageKeys.REPO_SOURCES, {} as Record<string, string>);
    delete map[normalizeRepo(repo)];
    this.set(StorageKeys.REPO_SOURCES, map);
  },

  saveSettings(updates: Partial<AppSettings>): void {
    // We only want to persist what the user has explicitly set
    // BUT we need to read the current stored object first (not the effective settings with env fallbacks)
    const currentStored = this.getRaw(StorageKeys.SETTINGS, {} as Partial<AppSettings>);
    const updated = { ...currentStored, ...updates };
    
    this.set(StorageKeys.SETTINGS, updated);
    
    // Notify app with the full effective settings
    const fullEffective = this.getSettings();
    window.dispatchEvent(new CustomEvent('settings_updated', { detail: fullEffective }));
  },

  getItem(key: string): string | null {
    return storage.getRaw<string | null>(key, null);
  },

  setItem(key: string, value: string): void {
    storage.set(key, value);
  },

  removeItem(key: string): void {
    storage.remove(key);
  }
};
