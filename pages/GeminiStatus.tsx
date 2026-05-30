import React, { useState, useEffect } from 'react';
import { listAvailableModelsDetailed, GeminiModelInfo, testModelConnectivity } from '../services/geminiService';
import { storage } from '../services/storageService';
import { ModelTier } from '../types';
import { 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Zap, 
  BrainCircuit, 
  Loader2, 
  RotateCcw,
  BarChart3,
  Info,
  ExternalLink,
  Lock,
  Activity,
  ThumbsUp,
  XCircle,
  Construction,
  Check
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import clsx from 'clsx';

interface ModelHealth {
  name: string;
  status: 'pending' | 'testing' | 'healthy' | 'restricted';
  lastError?: string;
}

export default function GeminiStatus() {
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, ModelHealth>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState(storage.getUsage());
  const settings = storage.getSettings();
  const currentTier = settings.defaultModelTier;
  const activeOverride = settings.geminiModelOverride;

  const fetchModels = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAvailableModelsDetailed(force);
      setModels(data);
      // Initialize health map
      const initialHealth: Record<string, ModelHealth> = {};
      data.forEach(m => {
        initialHealth[m.name] = { name: m.name, status: 'pending' };
      });
      setHealthMap(initialHealth);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Gemini API. Check your key in Settings.');
    } finally {
      setLoading(false);
    }
  };

  const selectModelOverride = (modelName: string) => {
    storage.saveSettings({ geminiModelOverride: modelName });
    window.location.reload();
  };

  const clearOverride = () => {
    storage.saveSettings({ geminiModelOverride: 'auto' });
    window.location.reload();
  };

  const runDiagnostic = async () => {
    if (models.length === 0) return;
    setTesting(true);
    
    // Test current tier first, then others
    const prioritizedModels = [...models].sort((a, b) => {
      const aRec = isRecommended(a) ? 1 : 0;
      const bRec = isRecommended(b) ? 1 : 0;
      return bRec - aRec;
    });

    for (const model of prioritizedModels) {
      setHealthMap(prev => ({
        ...prev,
        [model.name]: { ...prev[model.name], status: 'testing' }
      }));

      const result = await testModelConnectivity(model.name);
      
      setHealthMap(prev => ({
        ...prev,
        [model.name]: { 
          ...prev[model.name], 
          status: result.success ? 'healthy' : 'restricted',
          lastError: result.error
        }
      }));

      // Small delay between tests to avoid self-rate-limiting during diagnostic
      await new Promise(r => setTimeout(r, 200));
    }
    setTesting(false);
  };

  useEffect(() => {
    fetchModels();

    const handleUsageUpdate = (e: any) => {
      setUsage(e.detail);
    };
    window.addEventListener('usage_updated', handleUsageUpdate);
    return () => window.removeEventListener('usage_updated', handleUsageUpdate);
  }, []);

  const getTierIcon = (name: string) => {
    if (name.includes('pro')) return <BrainCircuit className="w-5 h-5 text-indigo-400" />;
    if (name.includes('flash')) return <Zap className="w-5 h-5 text-amber-400" />;
    return <Cpu className="w-5 h-5 text-slate-400" />;
  };

  const isRecommended = (model: GeminiModelInfo) => {
    if (currentTier === ModelTier.PRO && model.name.includes('pro')) return true;
    if (currentTier !== ModelTier.PRO && model.name.includes('flash') && !model.name.includes('lite')) return true;
    return false;
  };

  const healthiestRecommendation = models
    .filter(m => healthMap[m.name]?.status === 'healthy')
    .sort((a, b) => {
      // Prioritize Recommended markers first
      const aRec = isRecommended(a) ? 1 : 0;
      const bRec = isRecommended(b) ? 1 : 0;
      if (aRec !== bRec) return bRec - aRec;
      
      // Then prioritize Pro over Flash if healthy
      if (a.name.includes('pro') && !b.name.includes('pro')) return -1;
      if (b.name.includes('pro') && !a.name.includes('pro')) return 1;
      return 0;
    })[0];

  const groupedModels = {
    recommended: models.filter(m => isRecommended(m) && healthMap[m.name]?.status !== 'restricted'),
    available: models.filter(m => !isRecommended(m) && healthMap[m.name]?.status === 'healthy'),
    restricted: models.filter(m => healthMap[m.name]?.status === 'restricted' || healthMap[m.name]?.status === 'pending'),
  };

  const getUsageGuidance = () => {
    const isSandbox = window.location.hostname.includes('run.app') || !!(window as any).aistudio;
    if (isSandbox) {
      return {
        title: "Platform Resources",
        message: "You are running in the AI Studio environment. Models are brokered via ephemeral platform tokens. Quotas and billing are managed centrally.",
        link: "https://aistudio.google.com/",
        linkText: "AI Studio Dashboard"
      };
    }
    return {
      title: "Self-Hosted API Key",
      message: "You are using a custom Gemini API key. Monitor your project quotas in the Google Cloud Console (Generative Language API).",
      link: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas",
      linkText: "Check API Quotas"
    };
  };

  const guidance = getUsageGuidance();
  const isAutoSelection = activeOverride === 'auto' || !activeOverride;

  const selectTier = (tier: ModelTier) => {
    storage.saveSettings({ defaultModelTier: tier });
    // Local update to settings object in state if necessary, but we reload anyway for safety
    window.location.reload();
  };

  const renderModelRow = (model: GeminiModelInfo, isDimmed = false) => {
    const health = healthMap[model.name];
    const isPinned = model.name === activeOverride;
    return (
      <div key={model.name} className={clsx(
        "p-6 transition-colors group",
        (isPinned || (isRecommended(model) && isAutoSelection)) ? "bg-indigo-500/5" : "hover:bg-slate-800/30",
        (isDimmed || health?.status === 'restricted') && "opacity-60 grayscale-[0.5]"
      )}>
        <div className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="mt-1">
              {getTierIcon(model.name)}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-white font-bold">{model.displayName}</h3>
                {isPinned && (
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Lock className="w-3 h-3" /> PINNED DEFAULT
                  </span>
                )}
                {isRecommended(model) && isAutoSelection && (
                  <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold uppercase tracking-wider">
                    Auto-Selected
                  </span>
                )}
                {health?.status === 'healthy' && (
                  <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                    <CheckCircle2 className="w-3 h-3" /> VERIFIED
                  </span>
                )}
                {health?.status === 'restricted' && (
                  <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                    <XCircle className="w-3 h-3" /> QUOTA LIMITED
                  </span>
                )}
                {health?.status === 'testing' && (
                  <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                )}
              </div>
              <p className="text-sm text-slate-400 max-w-lg">{model.description}</p>
              {health?.lastError && (
                <p className="text-[10px] text-rose-500 font-mono mt-2 bg-rose-950/20 p-2 rounded border border-rose-950">
                  {health.status === 'restricted' ? "DIAGNOSTIC_RESTRICTION: " : "Error: "}{health.lastError}
                </p>
              )}
              <div className="flex items-center gap-4 pt-2 text-[10px] font-mono text-slate-500 uppercase">
                <span className="flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Limit: {Math.round(model.inputTokenLimit / 1000)}k/Tk
                </span>
                <span className="flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" />
                  ID: {model.name}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isPinned && (
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => selectModelOverride(model.name)}
                disabled={health?.status === 'restricted'}
                className="text-[10px] h-8 px-3"
              >
                Pin as Default
              </Button>
            )}
            {isPinned && (
              <div className="px-3 py-1.5 border border-amber-500/30 bg-amber-500/10 rounded text-[10px] text-amber-400 font-bold uppercase flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> Active
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-indigo-400" />
            Model Intelligence
          </h1>
          <p className="text-slate-400">
            Real-time verification of model reachability and quota availability for your active session.
          </p>
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-tight">
              <Zap className="w-3 h-3" />
              {(usage.totalTokens / 1000).toFixed(1)}k Tokens Consumed
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 uppercase tracking-tight">
              <Activity className="w-3 h-3" />
              {usage.totalRequests} Requests
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          {!isAutoSelection && (
            <Button variant="danger" size="sm" onClick={clearOverride} icon={RotateCcw}>
              Restore Auto-Selection
            </Button>
          )}
          <Button 
            onClick={() => fetchModels(true)} 
            variant="secondary" 
            isLoading={loading}
            icon={RotateCcw}
          >
            Refresh List
          </Button>
          <Button 
            onClick={runDiagnostic} 
            variant="primary" 
            isLoading={testing}
            disabled={loading || models.length === 0}
            icon={Activity}
          >
            Run Connectivity Diagnostic
          </Button>
        </div>
      </header>

      {/* INTELLIGENCE PREFERENCE (Tier Selection) */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden p-6 bg-linear-to-b from-slate-900/50 to-slate-950/50 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BrainCircuit className="w-6 h-6 text-indigo-400" />
              Intelligence Preference
            </h2>
            <p className="text-sm text-slate-400 max-w-lg">
              Set the foundational intelligence tier for all automated auditing tasks. 
              {currentTier === ModelTier.LITE && <span className="text-emerald-400 font-bold ml-1">Optimized for cost efficiency.</span>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
            <button
              onClick={() => selectTier(ModelTier.LITE)}
              className={clsx(
                "flex flex-col items-center gap-2 p-4 rounded-xl border text-[10px] transition-all font-bold uppercase tracking-widest",
                currentTier === ModelTier.LITE ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
              )}
            >
              <Zap className={clsx("w-5 h-5", currentTier === ModelTier.LITE ? "text-emerald-400" : "text-slate-600")} />
              <span>LITE</span>
            </button>
            <button
              onClick={() => selectTier(ModelTier.FLASH)}
              className={clsx(
                "flex flex-col items-center gap-2 p-4 rounded-xl border text-[10px] transition-all font-bold uppercase tracking-widest",
                currentTier === ModelTier.FLASH ? "bg-blue-500/10 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
              )}
            >
              <Cpu className={clsx("w-5 h-5", currentTier === ModelTier.FLASH ? "text-blue-400" : "text-slate-600")} />
              <span>FLASH</span>
            </button>
            <button
              onClick={() => selectTier(ModelTier.PRO)}
              className={clsx(
                "flex flex-col items-center gap-2 p-4 rounded-xl border text-[10px] transition-all font-bold uppercase tracking-widest",
                currentTier === ModelTier.PRO ? "bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
              )}
            >
              <BrainCircuit className={clsx("w-5 h-5", currentTier === ModelTier.PRO ? "text-purple-400" : "text-slate-600")} />
              <span>PRO</span>
            </button>
          </div>
        </div>
      </div>

      {/* AUTO-SELECTION HEADER */}
      <div className={clsx(
        "p-6 border rounded-2xl transition-all",
        isAutoSelection ? "bg-indigo-500/10 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.1)]" : "bg-slate-900/40 border-slate-800 opacity-60"
      )}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RotateCcw className={clsx("w-5 h-5", isAutoSelection ? "text-indigo-400" : "text-slate-500")} />
              <h3 className="text-lg font-bold text-white">Auto-Selection Mode (Default)</h3>
              {isAutoSelection && <Badge variant="green">ACTIVE</Badge>}
            </div>
            <p className="text-sm text-slate-400 max-w-xl">
              Dynamically rotates between healthy models within your <span className="text-white font-bold">{currentTier}</span> tier. High-priority tasks automatically upscale to avoid resource limits.
            </p>
          </div>
          {!isAutoSelection && (
            <Button variant="secondary" size="sm" onClick={clearOverride} className="text-[10px]">
              Enable Auto-Selection
            </Button>
          )}
        </div>
      </div>

      {/* Actionable Top Bar */}
      {Object.values(healthMap).some(h => h.status === 'healthy' || h.status === 'restricted') && (
        <div className={clsx(
          "bg-slate-900 border p-6 rounded-2xl flex flex-col md:flex-row items-center gap-6 animate-in slide-in-from-top-4 duration-500",
          healthiestRecommendation ? "border-indigo-500/30" : "border-rose-500/30"
        )}>
          {healthiestRecommendation ? (
            <>
              <div className="bg-indigo-500/10 p-3 rounded-full">
                <ThumbsUp className="w-8 h-8 text-indigo-400" />
              </div>
              <div className="flex-1 space-y-1 text-center md:text-left">
                <h2 className="text-lg font-bold text-white">Actionable Intel: Operational</h2>
                <p className="text-sm text-slate-400">
                  <span className="text-indigo-400 font-bold">{healthiestRecommendation.displayName}</span> is currently responding and has available quota. We recommend sticking to this tier for current activities.
                </p>
              </div>
              <div className="bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-500 font-mono">
                Healthy Choice: {healthiestRecommendation.name}
              </div>
            </>
          ) : (
            <>
              <div className="bg-rose-500/10 p-3 rounded-full">
                <XCircle className="w-8 h-8 text-rose-400" />
              </div>
              <div className="flex-1 space-y-1 text-center md:text-left">
                <h2 className="text-lg font-bold text-white">Actionable Intel: High Constraint Detected</h2>
                <p className="text-sm text-slate-400">
                  All probed models returned rate-limit or authorization errors. This usually indicates <span className="text-rose-400 font-bold">Quota Exhaustion</span> on your Google Cloud project or AI Studio account.
                </p>
              </div>
              <a 
                href={guidance.link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition"
              >
                Increase Quota
              </a>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* API Status Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 bg-slate-800/20 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Available Model Inventory
              </h2>
              <div className="flex items-center gap-2 px-2 py-1 bg-slate-800 rounded-lg border border-slate-700 text-xs text-slate-400 font-mono">
                {models.length} Discovered
              </div>
            </div>

            <div className="divide-y divide-slate-800">
              {loading ? (
                <div className="p-12 flex flex-col items-center justify-center text-slate-500 space-y-4">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <p className="animate-pulse">Negotiating with Google Cloud...</p>
                </div>
              ) : error ? (
                <div className="p-12 flex flex-col items-center justify-center text-center space-y-4">
                  <AlertCircle className="w-12 h-12 text-rose-500/50" />
                  <div className="space-y-1">
                    <p className="text-white font-bold">Connectivity Error</p>
                    <p className="text-slate-400 text-sm max-w-sm">{error}</p>
                  </div>
                  <Button onClick={() => window.location.href = '#/settings'} variant="primary" size="sm">
                    Go to Settings
                  </Button>
                </div>
              ) : (
                <>
                  {/* RECOMMENDED SECTION */}
                  {groupedModels.recommended.length > 0 && (
                    <div className="bg-indigo-500/5">
                      <div className="px-6 py-2 border-b border-slate-800 flex items-center gap-2 bg-slate-800/10">
                        <Zap className="w-3 h-3 text-indigo-400" />
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Recommended Tier Models</span>
                      </div>
                      {groupedModels.recommended.map(model => renderModelRow(model))}
                    </div>
                  )}

                  {/* AVAILABLE SECTION */}
                  {groupedModels.available.length > 0 && (
                    <div>
                      <div className="px-6 py-2 border-b border-slate-800 flex items-center gap-2 bg-slate-800/10">
                        <CheckCircle2 className="w-3 h-3 text-slate-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Other Available Inventory</span>
                      </div>
                      {groupedModels.available.map(model => renderModelRow(model))}
                    </div>
                  )}

                  {/* RESTRICTED SECTION */}
                  {groupedModels.restricted.length > 0 && (
                    <div className="bg-slate-900/40">
                      <div className="px-6 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/30">
                        <div className="flex items-center gap-2">
                          <XCircle className="w-3 h-3 text-slate-600" />
                          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Restricted or Quota Limited</span>
                        </div>
                        <span className="text-[10px] text-slate-700 italic">Excluded from auto-rotation</span>
                      </div>
                      <div className="divide-y divide-slate-800/50">
                        {groupedModels.restricted.map(model => renderModelRow(model, true))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* USAGE COUNTER */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 bg-linear-to-br from-indigo-500/[0.03] to-transparent shadow-lg">
            <h3 className="text-white font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-400" />
              Token Consumption
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Total Tokens</p>
                <p className="text-xl font-mono text-white">{(usage.totalTokens / 1000).toFixed(1)}k</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Requests</p>
                <p className="text-xl font-mono text-white">{usage.totalRequests}</p>
              </div>
            </div>
            {usage.lastRequestTokens > 0 && (
              <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between px-1 border-t border-slate-800 pt-3 mt-1">
                <span>Last payload:</span>
                <span className="text-indigo-400">{(usage.lastRequestTokens / 1000).toFixed(2)}k tokens</span>
              </div>
            )}
            <p className="text-xs text-slate-500 italic mt-2">
              Track the data footprint of your AI audit. Tokens are calculated based on both prompt and response payloads.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="space-y-2">
              <h3 className="text-white font-bold flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-400" />
                {guidance.title}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {guidance.message}
              </p>
            </div>
            <a 
              href={guidance.link} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl transition group"
            >
              <span className="text-sm font-semibold text-white">{guidance.linkText}</span>
              <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
            </a>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Construction className="w-5 h-5 text-amber-500" />
              Quota Management
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              If your preferred model is <span className="text-rose-400">Quota Limited</span>, switch your preference in Settings to a different tier. Gemini usually has separate quotas for <strong>Pro</strong> and <strong>Flash</strong> models.
            </p>
            <div className="pt-2">
              <Button onClick={() => window.location.href = '#/settings'} variant="secondary" size="sm" className="w-full">
                Open Preferences
              </Button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Lock className="w-5 h-5 text-indigo-500" />
              Privacy Note
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Connectivity tests generate a single "ping" request to verify your API key's standing. No repository data is transmitted during these diagnostics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
