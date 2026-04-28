console.log("[Server] Initializing application startup sequence...");

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

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
      if (endpoint.startsWith('/')) {
        endpoint = endpoint.substring(1);
      }

      const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      const julesUrl = `https://jules.googleapis.com/v1alpha/${endpoint}${queryString}`;
      
      const apiKey = req.headers['x-goog-api-key'] || req.query.key;
      
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (apiKey) {
        headers['X-Goog-Api-Key'] = apiKey;
      }

      console.log(`[Proxy] PREPARING: ${req.method} ${julesUrl}`);

      const fetchOptions: any = {
        method: req.method,
        headers,
      };

      if (!['GET', 'HEAD'].includes(req.method)) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      // Add a 60s timeout for the internal fetch to Jules
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(julesUrl, {
          ...fetchOptions,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        console.log(`[Proxy] RECEIVED: ${response.status} from Jules in ${Date.now() - startTime}ms`);

        if (response.status === 204) {
          return res.status(204).send();
        }

        const data = await response.json().catch(() => ({}));
        res.status(response.status).json(data);
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          throw new Error("Target API request timed out after 60s.");
        }
        throw fetchErr;
      }
    } catch (error: any) {
      console.error(`[Proxy] FAIL in ${Date.now() - startTime}ms:`, error.message);
      res.status(500).json({ 
        error: { 
          message: error.message,
          code: 'PROXY_ERROR',
          duration: Date.now() - startTime
        } 
      });
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
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Jules Proxy active at http://localhost:${PORT}/api/jules`);
  });
}

startServer();
