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
