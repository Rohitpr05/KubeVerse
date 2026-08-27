import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

// workspace.ts/local/paths.ts resolve KUBEVERSE_HOME/KUBEVERSE_PROJECTS_HOME
// at import time (see workspace.test.ts) - must be set before the first
// import below, or these tests would touch the developer's real ~/.kubeverse.
const kubeverseHome = mkdtempSync(join(tmpdir(), 'kubeverse-home-'));
const projectsHome = mkdtempSync(join(tmpdir(), 'kubeverse-projects-'));
process.env.KUBEVERSE_HOME = kubeverseHome;
process.env.KUBEVERSE_PROJECTS_HOME = projectsHome;

const { createProject } = await import('../workspace.js');
const { registerProjectRoutes } = await import('./projects.js');

function buildApp() {
  const app = Fastify();
  registerProjectRoutes(app);
  return app;
}

// Regression test for a real gap found during a security audit: the file-
// preview route's traversal guard (`GET /api/projects/:id/file?path=`) only
// ever did a *lexical* path.resolve/path.relative check, which correctly
// rejects "../"-style strings but never touches the filesystem - so a
// symlink planted inside a project directory, pointing anywhere outside it
// (e.g. at ~/.kubeverse/settings.json, which holds the user's AI API key),
// would lexically "look" like it's inside the project while actually
// resolving outside once the OS follows the symlink. The fix adds a second,
// realpath-based check after the lexical one.
test('the file-preview route rejects a symlink inside the project that points outside it', async () => {
  const app = buildApp();
  const outsideDir = mkdtempSync(join(tmpdir(), 'kubeverse-outside-'));
  try {
    const secretPath = join(outsideDir, 'secret.txt');
    writeFileSync(secretPath, 'super-secret-api-key');

    const project = createProject('Symlink Escape Test');
    symlinkSync(secretPath, join(project.path, 'escape-link'));

    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/file?path=escape-link` });
    assert.equal(response.statusCode, 400);
    assert.doesNotMatch(response.body, /super-secret-api-key/);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
    await app.close();
  }
});

test('the file-preview route still serves a genuine in-project file (the guard does not over-block)', async () => {
  const app = buildApp();
  try {
    const project = createProject('Legit File Test');
    writeFileSync(join(project.path, 'architecture.md'), '# hello');

    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/file?path=architecture.md` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { path: 'architecture.md', contents: '# hello' });
  } finally {
    await app.close();
  }
});

test('the file-preview route still rejects plain lexical "../" traversal (unchanged behavior)', async () => {
  const app = buildApp();
  try {
    const project = createProject('Traversal Test');
    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/file?path=${encodeURIComponent('../../etc/passwd')}` });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
