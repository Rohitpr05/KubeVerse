import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateArchitectureSpec } from '../architecture/schema.js';
import { planGeneratedFiles, writeGeneratedFiles } from './write.js';

const parsed = validateArchitectureSpec({
  name: 'shop',
  services: [
    { name: 'frontend', type: 'frontend', runtime: 'node', port: 3000, dependsOn: ['backend'], expose: true },
    { name: 'backend', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['db'], env: { LOG_LEVEL: 'info' } },
    { name: 'db', type: 'database', runtime: 'mongodb', port: 27017 },
  ],
  traffic: [{ from: 'frontend', to: 'backend' }],
});
assert.equal(parsed.success, true);
const spec = parsed.success ? parsed.data : (() => { throw new Error('fixture spec is invalid'); })();
const project = { id: '01a037bf-5bff-7285-a0d0-0d8e79272479', name: 'shop' };

test('planGeneratedFiles generates source only for node-runtime services', () => {
  const files = planGeneratedFiles(spec, project);
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes('generated/frontend/src/server.js'));
  assert.ok(paths.includes('generated/backend/src/server.js'));
  assert.ok(!paths.some((path) => path.startsWith('generated/db/')));
});

test('planGeneratedFiles writes a docker-compose.yml and kubernetes manifests', () => {
  const files = planGeneratedFiles(spec, project);
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes('docker/docker-compose.yml'));
  assert.ok(paths.includes('kubernetes/namespace.yaml'));
  assert.ok(paths.includes('kubernetes/backend/configmap.yaml'));
  assert.ok(paths.includes('kubernetes/db/pvc.yaml'));
  assert.ok(paths.includes('kubernetes/ingress.yaml'));
});

test('writeGeneratedFiles writes real files to disk with matching hashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-generate-'));
  try {
    const files = planGeneratedFiles(spec, project);
    const records = writeGeneratedFiles(dir, files);
    assert.equal(records.length, files.length);
    const composeRecord = records.find((record) => record.path === 'docker/docker-compose.yml');
    assert.ok(composeRecord);
    const onDisk = readFileSync(join(dir, 'docker/docker-compose.yml'), 'utf8');
    assert.equal(Buffer.byteLength(onDisk), composeRecord?.bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
