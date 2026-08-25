import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArchitectureSpec } from './schema.js';

const validSpec = {
  name: 'shop',
  services: [
    { name: 'frontend', type: 'frontend', runtime: 'node', port: 3000, dependsOn: ['backend'] },
    { name: 'backend', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['db'] },
    { name: 'db', type: 'database', runtime: 'mongodb', port: 27017 },
  ],
  traffic: [{ from: 'frontend', to: 'backend' }],
};

test('accepts a valid architecture and fills in defaults', () => {
  const result = validateArchitectureSpec(validSpec);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.version, 1);
  assert.equal(result.data.services[0]?.replicas, 1);
  assert.equal(result.data.services[0]?.healthCheck.path, '/health');
});

test('rejects a spec with no services', () => {
  const result = validateArchitectureSpec({ name: 'empty', services: [] });
  assert.equal(result.success, false);
});

test('rejects duplicate service names', () => {
  const result = validateArchitectureSpec({
    name: 'dup',
    services: [
      { name: 'api', type: 'backend', runtime: 'node', port: 4000 },
      { name: 'api', type: 'backend', runtime: 'node', port: 4001 },
    ],
  });
  assert.equal(result.success, false);
});

test('rejects a dependsOn reference to an unknown service', () => {
  const result = validateArchitectureSpec({
    name: 'dangling',
    services: [{ name: 'api', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['ghost'] }],
  });
  assert.equal(result.success, false);
});

test('rejects a non-kebab-case service name', () => {
  const result = validateArchitectureSpec({
    name: 'bad-name',
    services: [{ name: 'My Service', type: 'backend', runtime: 'node', port: 4000 }],
  });
  assert.equal(result.success, false);
});

// A real strict-mode OpenAI/OpenRouter response is now allowed to send
// explicit `null` for any field that has a default, instead of omitting it
// (see schema.ts's `withDefault`/`optionalNullable`). This mirrors exactly
// what such a response looks like and asserts it resolves to the same
// defaults as omitting the fields entirely.
test('accepts explicit nulls for every optional/defaulted field, resolving to defaults', () => {
  const result = validateArchitectureSpec({
    name: 'shop',
    version: null,
    services: [
      {
        name: 'api',
        type: 'backend',
        runtime: 'node',
        port: 4000,
        protocol: null,
        command: null,
        env: null,
        dependsOn: null,
        replicas: null,
        resources: { requests: { cpu: null, memory: null }, limits: null },
        healthCheck: { path: null, intervalSeconds: null, timeoutSeconds: 5 },
        volume: null,
        expose: null,
      },
    ],
    traffic: null,
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  const service = result.data.services[0]!;
  assert.equal(result.data.version, 1);
  assert.equal(result.data.traffic.length, 0);
  assert.equal(service.protocol, 'http');
  assert.equal(service.command, undefined);
  assert.deepEqual(service.env, {});
  assert.deepEqual(service.dependsOn, []);
  assert.equal(service.replicas, 1);
  assert.equal(service.resources.requests.cpu, '250m');
  assert.equal(service.resources.requests.memory, '256Mi');
  assert.equal(service.resources.limits.cpu, '250m');
  assert.equal(service.healthCheck.path, '/health');
  assert.equal(service.healthCheck.timeoutSeconds, 5);
  assert.equal(service.volume, undefined);
  assert.equal(service.expose, false);
});

test('accepts env as an array of {key, value} pairs (the wire shape sent to OpenRouter) and normalizes it to a record', () => {
  const result = validateArchitectureSpec({
    name: 'shop',
    services: [
      { name: 'api', type: 'backend', runtime: 'node', port: 4000, env: [{ key: 'LOG_LEVEL', value: 'info' }, { key: 'PORT', value: '4000' }] },
    ],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.services[0]?.env, { LOG_LEVEL: 'info', PORT: '4000' });
});

test('still accepts env as a plain object for existing internal callers', () => {
  const result = validateArchitectureSpec({
    name: 'shop',
    services: [{ name: 'api', type: 'backend', runtime: 'node', port: 4000, env: { LOG_LEVEL: 'info' } }],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.services[0]?.env, { LOG_LEVEL: 'info' });
});
