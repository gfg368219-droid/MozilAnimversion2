import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/api.js';

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true
  }
});