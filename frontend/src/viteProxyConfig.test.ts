import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../vite.config.js';

// Regression test for a real production incident: the dev proxy targeted
// "http://localhost:4000", and on some Linux setups Node's DNS/NSS
// resolution for the hostname "localhost" intermittently failed with
// "getaddrinfo ENOTFOUND localhost" - breaking every proxied request
// (/snapshot, /graph, /events, /api/*) even though the backend was up and
// listening. backend/src/server.ts binds to the explicit 127.0.0.1 loopback
// address by default, so the proxy must target that same literal address -
// never a hostname that requires a DNS/NSS lookup - to be immune to this
// class of failure.
test('every Vite dev proxy target is the literal 127.0.0.1 loopback address, never a hostname', () => {
  const proxy = config.server?.proxy;
  assert.ok(proxy && Object.keys(proxy).length > 0, 'expected at least one proxy rule');
  for (const [path, target] of Object.entries(proxy!)) {
    const value = typeof target === 'string' ? target : (target as { target?: string }).target;
    assert.equal(value, 'http://127.0.0.1:4000', `proxy rule for ${path} must target http://127.0.0.1:4000 exactly, got: ${value}`);
    assert.doesNotMatch(String(value), /localhost/, `proxy rule for ${path} must not use the "localhost" hostname: ${value}`);
  }
});

test('the proxy config covers every route the Playground actually depends on', () => {
  const proxy = config.server?.proxy ?? {};
  for (const path of ['/snapshot', '/graph', '/events', '/api']) {
    assert.ok(path in proxy, `expected a proxy rule for ${path}`);
  }
});

// Regression test for a real bug, reproduced live: /health, /ready, and
// /live are real backend routes (server.ts) that api.ts calls directly
// (getHealth/getReady, used by SettingsView and OnboardingView), but they
// were missing from this proxy list entirely. In browser dev mode, a
// request to an unproxied path silently hits Vite's own SPA fallback (200
// OK, index.html) instead of the backend - and since that "succeeded" with
// a 200 status, it was NOT caught as a network error. It surfaced instead as
// Settings' Kubernetes badge permanently showing "Unavailable" even while
// the Playground, at the very same moment, showed a fully healthy, connected
// cluster - because the non-JSON body silently resolved to `{}` (see
// api.ts's asJson, separately hardened not to do that any more). This test
// enumerates every top-level path any api.ts call actually fetches (not just
// the Playground's), so a future new route missing from this list fails
// here instead of silently misbehaving in the browser.
test('the proxy config covers every top-level path api.ts actually fetches, not just the Playground\'s', () => {
  const proxy = config.server?.proxy ?? {};
  for (const path of ['/snapshot', '/graph', '/events', '/resources', '/resource', '/timeline', '/logs', '/metrics', '/diagnostics', '/health', '/live', '/ready', '/api']) {
    assert.ok(path in proxy, `expected a proxy rule for ${path}`);
  }
});
