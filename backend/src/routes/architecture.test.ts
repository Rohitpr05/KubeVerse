import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import Fastify from 'fastify';

// See workspace.test.ts for why these must be set before the first import.
const kubeverseHome = mkdtempSync(join(tmpdir(), 'kubeverse-home-'));
const projectsHome = mkdtempSync(join(tmpdir(), 'kubeverse-projects-'));
process.env.KUBEVERSE_HOME = kubeverseHome;
process.env.KUBEVERSE_PROJECTS_HOME = projectsHome;

const { createProject, writeGeneratedState } = await import('../workspace.js');
const { registerArchitectureRoutes } = await import('./architecture.js');

function buildApp() {
  const app = Fastify();
  registerArchitectureRoutes(app);
  return app;
}

// Regression test for a real gap: /api/architecture/generate read the
// persisted spec from generated-state.json and generated files from it
// directly, without re-validating it against the *current* schema. A
// project compiled before the schema.ts fix that forces protocol:'tcp' for
// managed runtimes (see schema.test.ts) had exactly this stale shape
// persisted on disk (protocol: 'http' for a Redis service) - reproduced
// live against a real Kubernetes cluster, this generated an httpGet probe
// that crash-looped the Pod forever. Re-running generate for that same
// already-compiled project must now emit the corrected manifest, without
// requiring the user to recompile.
test('generate re-validates a stale persisted spec against the current schema, correcting an old protocol:"http" on a managed runtime', async () => {
  const app = buildApp();
  try {
    const project = createProject('Stale Spec Test');
    writeGeneratedState(project.path, {
      lastCompiledAt: new Date().toISOString(),
      spec: {
        name: 'stale-app',
        version: 1,
        services: [
          // As persisted by a pre-fix compile: no schema-level correction had
          // ever forced this to 'tcp'.
          { name: 'cache', type: 'cache', runtime: 'redis', port: 6379, protocol: 'http', env: {}, dependsOn: [], replicas: 1,
            resources: { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '250m', memory: '256Mi' } },
            healthCheck: { path: '/health', intervalSeconds: 10, timeoutSeconds: 3 }, expose: false },
        ],
        traffic: [],
      } as never,
    });

    const response = await app.inject({ method: 'POST', url: '/api/architecture/generate', payload: { projectId: project.id } });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { files: { path: string }[] };
    const deploymentRecord = body.files.find((file) => file.path === 'kubernetes/cache/deployment.yaml');
    assert.ok(deploymentRecord, 'expected kubernetes/cache/deployment.yaml to be generated');

    const { readFileSync } = await import('node:fs');
    const deploymentYaml = readFileSync(join(project.path, 'kubernetes/cache/deployment.yaml'), 'utf8');
    const deployment = parse(deploymentYaml) as any;
    const container = deployment.spec.template.spec.containers[0];
    assert.equal(container.readinessProbe.tcpSocket.port, 6379, 'stale protocol:"http" should have been corrected to a tcpSocket probe');
    assert.equal(container.readinessProbe.httpGet, undefined);
  } finally {
    await app.close();
  }
});

test('generate rejects a persisted spec that no longer validates at all, with a clear recompile message', async () => {
  const app = buildApp();
  try {
    const project = createProject('Invalid Spec Test');
    writeGeneratedState(project.path, {
      lastCompiledAt: new Date().toISOString(),
      spec: { name: 'broken', version: 1, services: [], traffic: [] } as never, // services.min(1) violation
    });

    const response = await app.inject({ method: 'POST', url: '/api/architecture/generate', payload: { projectId: project.id } });
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /[Rr]ecompile/);
  } finally {
    await app.close();
  }
});
