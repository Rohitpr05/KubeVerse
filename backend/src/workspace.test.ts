import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// workspace.ts and local/paths.ts both resolve KUBEVERSE_HOME at import time via
// a top-level `mkdirSync`, so it must be set before the first import below.
const kubeverseHome = mkdtempSync(join(tmpdir(), 'kubeverse-home-'));
process.env.KUBEVERSE_HOME = kubeverseHome;

const { openOrCreateProject, writeGeneratedState, listProjectsWithArchitecture } = await import('./workspace.js');
const { validateArchitectureSpec } = await import('./architecture/schema.js');

test('listProjectsWithArchitecture reports real compile/generate status per project', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'kubeverse-project-'));
  try {
    const project = openOrCreateProject(projectDir, 'demo');

    const beforeCompile = listProjectsWithArchitecture().find((entry) => entry.id === project.id);
    assert.equal(beforeCompile?.architecture.compiled, false);

    const parsed = validateArchitectureSpec({
      name: 'shop',
      services: [{ name: 'api', type: 'backend', runtime: 'node', port: 4000 }],
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    writeGeneratedState(project.path, { lastCompiledAt: new Date().toISOString(), spec: parsed.data });

    const afterCompile = listProjectsWithArchitecture().find((entry) => entry.id === project.id);
    assert.equal(afterCompile?.architecture.compiled, true);
    assert.equal(afterCompile?.architecture.name, 'shop');
    assert.equal(afterCompile?.architecture.serviceCount, 1);
    assert.equal(afterCompile?.architecture.lastGeneratedAt, undefined);

    writeGeneratedState(project.path, { lastGeneratedAt: new Date().toISOString(), files: [{ path: 'docker/docker-compose.yml', bytes: 10, sha256: 'x' }] });
    const afterGenerate = listProjectsWithArchitecture().find((entry) => entry.id === project.id);
    assert.equal(afterGenerate?.architecture.generatedFileCount, 1);
    assert.ok(afterGenerate?.architecture.lastGeneratedAt);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(kubeverseHome, { recursive: true, force: true });
  }
});
