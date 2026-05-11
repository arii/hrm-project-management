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

  // Jules API Proxy - mount at /api/jules
  app.use("/api/jules", async (req, res) => {
    const startTime = Date.now();
    try {
      // With app.use("/api/jules", ...), req.url contains the relative path after the mount point
      // e.g. /api/jules/sessions/123?key=abc -> req.url is /sessions/123?key=abc
      // e.g. /api/jules -> req.url is /
      
      let relativePath = req.url;
      if (relativePath === '/' || !relativePath) {
        if (req.method === 'GET') {
          return res.json({ status: "Jules Proxy Active", available: true });
        }
        throw new Error("No Jules endpoint specified.");
      }

      // Remove leading slash for v1alpha1 concatenation
      const pathPart = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
      
      // We use v1alpha1 as it's the most common for these developer tool APIs
      const julesUrl = `https://jules.googleapis.com/v1alpha1/${pathPart}`;
      
      const apiKey = req.headers['x-goog-api-key'] || req.query.key;
      
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (apiKey) {
        headers['X-Goog-Api-Key'] = apiKey;
      }

      console.log(`[Proxy] PREPARING [v1alpha1]: ${req.method} ${julesUrl}`);

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
        console.log(`[Proxy] FETCHING from Jules: ${julesUrl}`);
        const response = await fetch(julesUrl, {
          ...fetchOptions,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const rawText = await response.text();
        console.log(`[Proxy] RESPONSE from Jules: ${response.status} ${response.statusText}. Length: ${rawText.length}`);

        if (response.status >= 400) {
           console.error(`[Proxy] Jules API Error: ${response.status} ${rawText.substring(0, 500)}`);
        }

        if (response.status === 204 || (!rawText && response.status === 200)) {
          return res.status(response.status).send(response.status === 204 ? undefined : '{}');
        }

        try {
          // Verify it's valid JSON before sending as application/json
          if (rawText.trim()) {
            JSON.parse(rawText);
          }
          res.status(response.status).set('Content-Type', 'application/json').send(rawText || '{}');
        } catch (parseErr) {
          console.warn(`[Proxy] Non-JSON response received from Jules (Status: ${response.status})`);
          // Wrap non-JSON in a JSON object to avoid client-side parse errors
          res.status(response.status).json({ 
            rawResponse: rawText.substring(0, 1000), 
            isNonJson: true 
          });
        }
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
