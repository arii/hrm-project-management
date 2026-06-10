import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization, X-Goog-Api-Key',
        },
        proxy: {
          '/api/github': {
            target: 'https://api.github.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/github/, ''),
            headers: {
              'User-Agent': 'RepoAuditor-AI-Proxy'
            }
          },
          '/api/jules': {
            target: 'https://jules.googleapis.com/v1alpha',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/jules/, ''),
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GITHUB_TOKEN': JSON.stringify(env.GITHUB_TOKEN)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
