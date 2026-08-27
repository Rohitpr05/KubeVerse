import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks only to the platform backend through this development proxy.
//
// The proxy target is the literal loopback IP, not the hostname "localhost":
// resolving "localhost" goes through Node's DNS/NSS resolution (getaddrinfo),
// which has been observed to intermittently fail with ENOTFOUND on some Linux
// setups even though /etc/hosts maps it correctly - a real production
// incident here was "[vite] http proxy error: ... Error: getaddrinfo ENOTFOUND
// localhost" on every proxied request. backend/src/server.ts already binds to
// the explicit 127.0.0.1 loopback address by default (not "localhost"), so
// pointing the proxy at the same literal address removes hostname resolution
// from this path entirely - there is nothing to look up, so nothing to fail
// to look up. This is the same address on Linux, Windows, and macOS.
const BACKEND_ORIGIN = 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/snapshot': BACKEND_ORIGIN,
      '/events': BACKEND_ORIGIN,
      '/graph': BACKEND_ORIGIN,
      '/resources': BACKEND_ORIGIN,
      '/resource': BACKEND_ORIGIN,
      '/timeline': BACKEND_ORIGIN,
      '/logs': BACKEND_ORIGIN,
      '/metrics': BACKEND_ORIGIN,
      '/diagnostics': BACKEND_ORIGIN,
      '/api': BACKEND_ORIGIN
    }
  }
});
