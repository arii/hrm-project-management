// console.log("[Server] Initializing application startup sequence...");

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Permissive CORS middleware for cross-origin and iframe compliance
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Goog-Api-Key, X-Ignore-Error");
    
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // GitHub API Proxy
  app.all("/api/github*", async (req, res) => {
    try {
      const endpoint = req.path.replace(/^\/api\/github/, '');
      const githubUrl = `https://api.github.com${endpoint}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
      
      const authHeader = req.headers['authorization'];
      const headers: any = {
        'Accept': req.headers['accept'] || 'application/vnd.github.v3+json',
        'User-Agent': 'RepoAuditor-AI-Proxy'
      };
      
      if (authHeader) headers['Authorization'] = authHeader;
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

      // console.log(`[GithubProxy] ${req.method} ${githubUrl}`);

      const fetchOptions: any = {
        method: req.method,
        headers,
      };

      if (!['GET', 'HEAD'].includes(req.method)) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(githubUrl, {
        ...fetchOptions,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await response.text();

      res.status(response.status).set('Content-Type', response.headers.get('content-type') || 'application/json').send(data);
    } catch (error: any) {
      console.error(`[GithubProxy] Error:`, error.message);
      res.status(500).json({ 
        error: {
          message: error.message || 'Unknown GitHub Proxy Error',
          code: 'GITHUB_PROXY_ERROR'
        }
      });
    }
  });

  // Jules API Proxy - handle base and sub-paths
  app.all("/api/jules*", async (req, res) => {
    const startTime = Date.now();
    try {
      // Get the relative path after /api/jules
      // e.g. /api/jules/sessions/123 -> /sessions/123
      // e.g. /api/jules -> /
      let endpoint = req.path.replace(/^\/api\/jules/, '');
      if (!endpoint || endpoint === '/') {
        // If just /api/jules is hit, we don't have a target endpoint
        if (req.method === 'GET') {
          return res.json({ status: "Jules Proxy Active", available: true });
        }
        throw new Error("No Jules endpoint specified.");
      }
      
      // Remove leading slash for v1alpha concatenation
      endpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;

      const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      const julesUrl = `https://jules.googleapis.com/v1alpha/${endpoint}${queryString}`;
      
      const apiKey = req.headers['x-goog-api-key'] || req.headers['X-Goog-Api-Key'] || req.query.key;
      
      const headers: any = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      
      if (apiKey) {
        headers['X-Goog-Api-Key'] = apiKey;
      }

      // console.log(`[Proxy] Request: ${req.method} ${req.path} -> Targeting Jules: ${julesUrl}`);
      // console.log(`[Proxy] Headers:`, JSON.stringify({ ...headers, 'X-Goog-Api-Key': 'REDACTED' }));

      try {
        const fs = await import('fs/promises');
        const logData = {
          time: new Date().toISOString(),
          method: req.method,
          url: julesUrl,
          body: req.body,
        };
        await fs.mkdir('logs', { recursive: true });
        await fs.appendFile('logs/jules.log', JSON.stringify(logData) + '\n');
      } catch (e) {}

      const fetchOptions: any = {
        method: req.method,
        headers,
      };

      if (!['GET', 'HEAD'].includes(req.method)) {
        const bodyValue = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        fetchOptions.body = bodyValue;
      }

      // Add a 60s timeout for the internal fetch to Jules
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        // console.log(`[Proxy] Target URL: ${julesUrl}`);
        // console.log(`[Proxy] Method: ${req.method}`);
        
        const response = await fetch(julesUrl, {
          ...fetchOptions,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const rawText = await response.text();
        const ignoreError = req.headers['x-ignore-error'] === 'true' || req.headers['X-Ignore-Error'] === 'true';

        if (!ignoreError) {
          // console.log(`[Proxy] Jules response [${response.status}]: Characters: ${rawText.length}`);

          if (response.status >= 400) {
            let errorBody = rawText;
            try {
              const parsed = JSON.parse(rawText);
              errorBody = JSON.stringify(parsed);
            } catch (e) {
              // Not JSON, keep as is
            }
            console.warn(`[Proxy] Jules error [${response.status}]: ${errorBody}`);
            console.warn(`[Proxy] Original request body: ${JSON.stringify(req.body)}`);
          }
        }

        // Forward status and headers
        res.status(response.status);
        
        // Handle empty/no-content responses
        if (response.status === 204 || (!rawText.trim() && response.status === 200)) {
          return res.send(response.status === 204 ? undefined : '{}');
        }

        try {
          // If it's valid JSON, send it with the right content-type
          if (rawText.trim()) {
            JSON.parse(rawText);
            res.set('Content-Type', 'application/json');
          }
          res.send(rawText);
        } catch (parseErr) {
          console.warn(`[Proxy] Non-JSON or malformed JSON from Jules: ${rawText.substring(0, 100)}...`);
          res.set('Content-Type', 'text/plain');
          res.send(rawText);
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        console.error(`[Proxy] Internal fetch error:`, fetchErr);
        if (fetchErr.name === 'AbortError') {
          throw new Error("Target API request timed out after 60s.");
        }
        throw fetchErr;
      }
    } catch (error: any) {
      console.error(`[Proxy] Final catch block error:`, error.message);
      res.status(500).json({ 
        error: { 
          message: error.message || 'Unknown Proxy Error',
          code: 'PROXY_ERROR',
          duration: Date.now() - startTime
        } 
      });
    }
  });

  // Gemini API Proxy/Execution Endpoints
  app.post("/api/gemini/:method", async (req, res) => {
    const { method } = req.params;
    const body = req.body || {};
    const clientApiKey = req.headers['x-gemini-api-key'] as string;
    
    try {
      const geminiService = await import("./services/geminiService");
      
      geminiService.setGeminiApiKey(clientApiKey || null);
      
      let result;
      switch (method) {
        case "listAvailableModelsDetailed":
          result = await geminiService.listAvailableModelsDetailed(body.forceRefresh);
          break;
        case "testModelConnectivity":
          result = await geminiService.testModelConnectivity(body.modelName);
          break;
        case "analyzeWorkflowBatch":
          result = await geminiService.analyzeWorkflowBatch(body.repo, body.runs, body.geminiKey);
          break;
        case "analyzeWorkflowHealth":
          result = await geminiService.analyzeWorkflowHealth(body.run, body.jobs, body.annotations, body.workflowFile, body.tier);
          break;
        case "analyzeWorkflowQualitative":
          result = await geminiService.analyzeWorkflowQualitative(body.workflows, body.runs, body.repoContext, body.tier);
          break;
        case "analyzePullRequests":
          result = await geminiService.analyzePullRequests(body.prs);
          break;
        case "generateCodeReview":
          result = await geminiService.generateCodeReview(body.pr, body.diff, body.options);
          break;
        case "extractIssuesFromComments":
          result = await geminiService.extractIssuesFromComments(body.comments);
          break;
        case "analyzePrForRestart":
          result = await geminiService.analyzePrForRestart(body.pr, body.diff, body.tier);
          break;
        case "analyzePrForSync":
          result = await geminiService.analyzePrForSync(body.pr, body.diff);
          break;
        case "parseIssuesFromText":
          result = await geminiService.parseIssuesFromText(body.text);
          break;
        default:
          return res.status(404).json({ error: `Unknown Gemini method: ${method}` });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error(`[Server] Gemini execution error for method "${method}":`, error);
      res.status(500).json({ error: error.message || 'Unknown Gemini Server Error' });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    // console.log(`[Server] Success: Application listening on port ${PORT}`);
    // console.log(`[Server] Jules Proxy active at /api/jules/`);
    // console.log(`[Server] Health check at /api/health`);
  });
}

startServer().catch((err) => {
  console.error("[Server] Critical failure during startup:", err);
  process.exit(1);
});
