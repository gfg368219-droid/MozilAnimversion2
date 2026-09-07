import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { uploadApiPlugin } from './server/upload-api.js';
import { animeSamaApiPlugin } from './server/anime-sama-api.js';
import { handleApiRequest, startImportWorker } from './server/api-handler.js';

export default defineConfig({
  plugins: [
    react(),
    uploadApiPlugin(),
    animeSamaApiPlugin(),
    {
      name: 'mozilanim-catalog-api',
      configureServer(server) {
        startImportWorker();
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url || '/', 'http://localhost').pathname;
          if (!['/api/catalog', '/api/admin/session'].includes(pathname) && !pathname.startsWith('/api/import-jobs')) return next();
          return handleApiRequest(request, response);
        });
      },
      configurePreviewServer(server) {
        startImportWorker();
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url || '/', 'http://localhost').pathname;
          if (!['/api/catalog', '/api/admin/session'].includes(pathname) && !pathname.startsWith('/api/import-jobs')) return next();
          return handleApiRequest(request, response);
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    fs: { strict: true }
  },
  build: {
    sourcemap: false
  }
});