import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks only to the platform backend through this development proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/snapshot': 'http://localhost:4000',
      '/events': 'http://localhost:4000',
      '/graph': 'http://localhost:4000',
      '/resources': 'http://localhost:4000',
      '/resource': 'http://localhost:4000',
      '/timeline': 'http://localhost:4000',
      '/logs': 'http://localhost:4000',
      '/metrics': 'http://localhost:4000',
      '/diagnostics': 'http://localhost:4000',
      '/api': 'http://localhost:4000'
    }
  }
});
