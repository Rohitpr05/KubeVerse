import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// workspace.ts and local/paths.ts both resolve KUBEVERSE_HOME/KUBEVERSE_PROJECTS_HOME
// at import time via a top-level `mkdirSync`, so both must be set before the
// first import below - otherwise these tests would create real directories
// under the developer's actual ~/.kubeverse and ~/KubeVerse.
const kubeverseHome = mkdtempSync(join(tmpdir(), 'kubeverse-home-'));
const projectsHome = mkdtempSync(join(tmpdir(), 'kubeverse-projects-'));
process.env.KUBEVERSE_HOME = kubeverseHome;
process.env.KUBEVERSE_PROJECTS_HOME = projectsHome;

const { createProject, getProjectById, listRecentProjects, openOrCreateProject, readArchitectureSource, readGeneratedState, writeArchitectureSource, writeGeneratedState, listProjectsWithArchitecture } = await import('./workspace.js');
const { projectsRoot } = await import('./local/paths.js');
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
  }
});

test('createProject creates the project under the dedicated projects workspace, not an arbitrary/source path', () => {
  const project = createProject('My E-Commerce App');
  assert.equal(project.name, 'My E-Commerce App');
  assert.ok(project.path.startsWith(projectsRoot()), `${project.path} should live under ${projectsRoot()}`);
  assert.ok(existsSync(join(project.path, 'architecture.md')));
  assert.ok(existsSync(join(project.path, '.kubeverse', 'metadata.json')));
});

test('createProject turns an arbitrary project name into a safe, readable directory name', () => {
  const project = createProject('My   Bakery / Shop*Name');
  assert.equal(project.path, join(projectsRoot(), 'My Bakery Shop Name'));
});

test('createProject never merges two projects that sanitize to the same directory name - it suffixes instead', () => {
  const first = createProject('Shop');
  const second = createProject('Shop');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.path, second.path);
  assert.equal(second.path, join(projectsRoot(), 'Shop-2'));
});

test('createProject rejects an empty/whitespace-only name without creating anything', () => {
  assert.throws(() => createProject('   '));
});

test('two projects created via createProject are completely isolated: writing to one never touches the other', () => {
  const projectA = createProject('Isolation Test A');
  const projectB = createProject('Isolation Test B');
  const untouchedTemplate = readArchitectureSource(projectB.path);

  writeArchitectureSource(projectA.path, '# Project A architecture\nOnly A.\n');
  writeGeneratedState(projectA.path, { lastCompiledAt: '2026-01-01T00:00:00Z' });

  assert.equal(readArchitectureSource(projectA.path), '# Project A architecture\nOnly A.\n');
  // B must still have its untouched starter template and no generated-state.json at all.
  assert.equal(readArchitectureSource(projectB.path), untouchedTemplate);
  assert.equal(readGeneratedState(projectB.path).lastCompiledAt, undefined);
  assert.equal(existsSync(join(projectB.path, '.kubeverse', 'generated-state.json')), false);
});

test('lastDeployedAt survives an unrelated generated-state patch and is exposed through the architecture status summary', () => {
  const project = createProject('Deploy Status Test');
  writeGeneratedState(project.path, { lastCompiledAt: new Date().toISOString() });
  writeGeneratedState(project.path, { lastDeployedAt: '2026-01-01T00:00:00Z' });
  const summary = listProjectsWithArchitecture().find((entry) => entry.id === project.id);
  assert.equal(summary?.architecture.lastDeployedAt, '2026-01-01T00:00:00Z');
  assert.ok(summary?.architecture.lastCompiledAt);
});

test('architecture.md persists to the project directory and round-trips exactly', () => {
  const project = createProject('Persistence Test');
  const content = '# Persistence Test\n\n## Backend\nNode.js, port 4000\n';
  writeArchitectureSource(project.path, content);
  assert.equal(readArchitectureSource(project.path), content);
  // Re-reading the project by id must see the same persisted content, not a
  // cached/in-memory copy - this is the exact path POST /api/architecture/compile uses.
  const reopened = getProjectById(project.id);
  assert.ok(reopened);
  assert.equal(readArchitectureSource(reopened!.path), content);
});

test('recent projects are ordered most-recently-opened first, and re-opening moves a project back to the front', () => {
  const first = createProject('Recency A');
  const second = createProject('Recency B');
  const recentAfterCreate = listRecentProjects().map((entry) => entry.path);
  assert.equal(recentAfterCreate[0], second.path);
  assert.equal(recentAfterCreate[1], first.path);

  // Re-opening the older project must move it back to the front.
  openOrCreateProject(first.path, first.name);
  const recentAfterReopen = listRecentProjects().map((entry) => entry.path);
  assert.equal(recentAfterReopen[0], first.path);
});

test.after(() => {
  rmSync(kubeverseHome, { recursive: true, force: true });
  rmSync(projectsHome, { recursive: true, force: true });
});
