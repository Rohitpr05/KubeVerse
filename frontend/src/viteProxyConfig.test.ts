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
