import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.js';

function fakeHtmlResponse(): Response {
  // Exactly what Vite's dev-server SPA fallback returns for an unproxied
  // path: 200 OK, Content-Type: text/html, some HTML body - not the JSON
  // every api.ts caller expects.
  return new Response('<!doctype html><html><body>KubeVerse</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

// Regression test: this is exactly what happened live when /health and
// /ready were missing from vite.config.ts's proxy list (now fixed) - a
// misrouted request that "succeeds" with a 200 but isn't real JSON used to
// be silently swallowed into a fake `{}` "success", which is what made
// Settings' Kubernetes badge show "Unavailable" forever instead of a visible
// error. A 2xx response that fails to parse as JSON must now be a real,
// catchable rejection.
test('a 2xx response that is not valid JSON rejects instead of silently resolving to {}', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => fakeHtmlResponse()) as typeof fetch;
  try {
    await assert.rejects(() => api.getHealth());
    await assert.rejects(() => api.getReady());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a non-2xx response with a real JSON error body still rejects with that message (unchanged behavior)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'Project not found. Open it first with POST /api/projects.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    await assert.rejects(() => api.getProject('missing'), /Project not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a normal 200 JSON response still resolves normally (unchanged behavior)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 'ok', service: 'platform-backend' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    const result = await api.getHealth();
    assert.deepEqual(result, { status: 'ok', service: 'platform-backend' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
