import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
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

interface ComposeFixture { services: Record<string, { ports: string[]; image?: string }> }

function composeFrom(files: { path: string; contents: string }[]): ComposeFixture {
  const compose = files.find((file) => file.path === 'docker/docker-compose.yml');
  assert.ok(compose, 'docker/docker-compose.yml must be generated');
  return parseYaml(compose!.contents) as ComposeFixture;
}

function kubernetesImageOf(files: { path: string; contents: string }[], serviceName: string): string {
  const deploymentFile = files.find((file) => file.path === `kubernetes/${serviceName}/deployment.yaml`);
  assert.ok(deploymentFile, `kubernetes/${serviceName}/deployment.yaml must be generated`);
  const deployment = parseYaml(deploymentFile!.contents) as any;
  return deployment.spec.template.spec.containers[0].image;
}

function hostPortsOf(compose: ComposeFixture): number[] {
  return Object.values(compose.services).map((service) => Number(service.ports[0].split(':')[0]));
}

async function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('planGeneratedFiles generates source only for node-runtime services', async () => {
  const files = await planGeneratedFiles(spec, project);
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes('generated/frontend/src/server.js'));
  assert.ok(paths.includes('generated/backend/src/server.js'));
  assert.ok(!paths.some((path) => path.startsWith('generated/db/')));
});

test('planGeneratedFiles writes a docker-compose.yml and kubernetes manifests', async () => {
  const files = await planGeneratedFiles(spec, project);
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes('docker/docker-compose.yml'));
  assert.ok(paths.includes('kubernetes/namespace.yaml'));
  assert.ok(paths.includes('kubernetes/backend/configmap.yaml'));
  assert.ok(paths.includes('kubernetes/db/pvc.yaml'));
  assert.ok(paths.includes('kubernetes/ingress.yaml'));
});

test('writeGeneratedFiles writes real files to disk with matching hashes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-generate-'));
  try {
    const files = await planGeneratedFiles(spec, project);
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

// Regression tests for a real production incident: `docker compose up`
// failed with "bind: address already in use" because the generator
// published every service as `${service.port}:${service.port}` - the same
// number as the CONTAINER port - and the fixture's own "backend" service
// (like the architecture.md starter template's own example) uses port 4000,
// the exact port KubeVerse's own backend listens on.

test('the generated host port never collides with a port already in use, while the container port stays exactly what the spec declared', async () => {
  // Occupy the fixture's declared backend port (4000) for real, to prove the
  // allocator genuinely avoids an in-use port rather than merely happening
  // not to pick it - this is the exact real-world scenario the fix
  // addresses (KubeVerse's own backend already listening on 4000). If
  // something else already holds 4000 (e.g. a real KubeVerse backend
  // running on this machine while the test runs), that's an equally valid
  // precondition for this test, so binding it ourselves is best-effort.
  const occupied = await listenOn(4000).catch(() => undefined);
  try {
    const files = await planGeneratedFiles(spec, project);
    const compose = composeFrom(files);
    const [hostPort, containerPort] = compose.services.backend.ports[0].split(':');
    assert.equal(containerPort, '4000', 'the container port must remain exactly what the architecture declared');
    assert.notEqual(hostPort, '4000', 'the host port must never collide with a port already in use');
  } finally {
    if (occupied) await close(occupied);
  }
});

test('every service in one generated project gets a distinct host port from every other service', async () => {
  const files = await planGeneratedFiles(spec, project);
  const hostPorts = hostPortsOf(composeFrom(files));
  assert.equal(hostPorts.length, spec.services.length);
  assert.equal(new Set(hostPorts).size, hostPorts.length, `host ports must all be distinct within one project, got: ${hostPorts.join(', ')}`);
});

// Regression tests for the production incident where Docker Compose and the
// Kubernetes generator independently invented two different image names for
// the same service, so Kubernetes ended up trying to pull an image Docker
// never built under that name (Pods failing with "pull access denied /
// repository does not exist" against a free-text architecture-derived name).

test('the Docker Compose image and the Kubernetes Deployment image are exactly the same reference for the same service', async () => {
  const files = await planGeneratedFiles(spec, project);
  const compose = composeFrom(files);
  for (const serviceName of ['frontend', 'backend']) {
    assert.equal(compose.services[serviceName].image, kubernetesImageOf(files, serviceName), `docker-compose.yml and kubernetes/${serviceName}/deployment.yaml must reference the same image`);
  }
});

test('two different KubeVerse projects never produce colliding local image names for the same service name', async () => {
  const otherProject = { id: '01a037bf-5bff-7285-a0d0-0d8e79272481', name: 'shop' };
  const filesA = await planGeneratedFiles(spec, project);
  const filesB = await planGeneratedFiles(spec, otherProject);
  assert.notEqual(kubernetesImageOf(filesA, 'backend'), kubernetesImageOf(filesB, 'backend'));
  assert.notEqual(composeFrom(filesA).services.backend.image, composeFrom(filesB).services.backend.image);
});

test('a second project generated while the first project\'s allocated ports are actually bound receives different host ports', async () => {
  const filesA = await planGeneratedFiles(spec, project);
  const portsA = hostPortsOf(composeFrom(filesA));

  // Simulate project A's containers actually being up - the way
  // `docker compose up` would leave their published host ports genuinely
  // bound - rather than just checking that two allocations happen not to
  // collide by chance.
  const servers = await Promise.all(portsA.map((port) => listenOn(port)));
  try {
    const otherProject = { id: '01a037bf-5bff-7285-a0d0-0d8e79272480', name: 'shop-2' };
    const filesB = await planGeneratedFiles(spec, otherProject);
    const portsB = hostPortsOf(composeFrom(filesB));
    for (const port of portsB) {
      assert.ok(!portsA.includes(port), `project B's host port ${port} must not collide with project A's already-bound ports (${portsA.join(', ')})`);
    }
  } finally {
    await Promise.all(servers.map(close));
  }
});
