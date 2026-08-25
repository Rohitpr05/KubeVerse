import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { validateArchitectureSpec } from '../architecture/schema.js';
import { MANAGED_BY_LABEL, MANAGED_BY_VALUE, PROJECT_ID_LABEL, PROJECT_NAME_LABEL } from '../ownership.js';
import { generateKubernetesManifests } from './kubernetes.js';

const parsed = validateArchitectureSpec({
  name: 'shop',
  services: [
    { name: 'frontend', type: 'frontend', runtime: 'node', port: 3000, dependsOn: ['backend'], expose: true },
    { name: 'backend', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['db'], env: { LOG_LEVEL: 'info' } },
    { name: 'db', type: 'database', runtime: 'postgres', port: 5432 },
  ],
  traffic: [{ from: 'frontend', to: 'backend' }],
});
assert.equal(parsed.success, true);
const spec = parsed.success ? parsed.data : (() => { throw new Error('fixture spec is invalid'); })();

// A real project name from this repo's own TEST-001 project: contains a
// space, which is not a legal Kubernetes label value on its own - this
// fixture exercises sanitizeLabelValue for real, not just in isolation.
const project = { id: '01a037bf-5bff-7285-a0d0-0d8e79272479', name: 'TEST -001' };

function labelsOf(contents: string): Record<string, string> {
  const doc = parse(contents) as { metadata?: { labels?: Record<string, string> } };
  return doc.metadata?.labels ?? {};
}

test('every generated Kubernetes resource carries the KubeVerse ownership labels', () => {
  const files = generateKubernetesManifests(spec, project);
  assert.ok(files.length > 0);
  for (const file of files) {
    const labels = labelsOf(file.contents);
    assert.equal(labels[MANAGED_BY_LABEL], MANAGED_BY_VALUE, `${file.path}: missing/wrong ${MANAGED_BY_LABEL}`);
    assert.equal(labels[PROJECT_ID_LABEL], project.id, `${file.path}: missing/wrong ${PROJECT_ID_LABEL}`);
    assert.equal(labels[PROJECT_NAME_LABEL], 'TEST-001', `${file.path}: missing/wrong sanitized ${PROJECT_NAME_LABEL}`);
  }
});

test('the Deployment pod template also carries ownership labels, so the ReplicaSet/Pods Kubernetes creates inherit them', () => {
  const files = generateKubernetesManifests(spec, project);
  const deploymentFile = files.find((file) => file.path === 'kubernetes/backend/deployment.yaml');
  assert.ok(deploymentFile);
  const deployment = parse(deploymentFile!.contents) as any;
  const templateLabels = deployment.spec.template.metadata.labels;
  assert.equal(templateLabels[PROJECT_ID_LABEL], project.id);
  assert.equal(templateLabels[MANAGED_BY_LABEL], MANAGED_BY_VALUE);
  // The selector must remain scoped to this one service only - Kubernetes
  // requires it to be a subset of the template's labels, never the other way
  // around, and it must stay specific enough to not also select another
  // service's pods within the same project namespace.
  assert.deepEqual(deployment.spec.selector.matchLabels, { app: 'backend' });
});

test('every generated resource kind that should carry ownership labels does: Namespace, Deployment, Service, ConfigMap, Secret, PVC, Ingress', () => {
  const files = generateKubernetesManifests(spec, project);
  const byPath = new Map(files.map((file) => [file.path, parse(file.contents) as any]));

  assert.equal(byPath.get('kubernetes/namespace.yaml')?.kind, 'Namespace');
  assert.equal(byPath.get('kubernetes/backend/deployment.yaml')?.kind, 'Deployment');
  assert.equal(byPath.get('kubernetes/backend/service.yaml')?.kind, 'Service');
  assert.equal(byPath.get('kubernetes/backend/configmap.yaml')?.kind, 'ConfigMap');
  assert.equal(byPath.get('kubernetes/db/secret.yaml')?.kind, 'Secret');
  assert.equal(byPath.get('kubernetes/db/pvc.yaml')?.kind, 'PersistentVolumeClaim');
  assert.equal(byPath.get('kubernetes/ingress.yaml')?.kind, 'Ingress');

  for (const path of ['kubernetes/namespace.yaml', 'kubernetes/backend/deployment.yaml', 'kubernetes/backend/service.yaml', 'kubernetes/backend/configmap.yaml', 'kubernetes/db/secret.yaml', 'kubernetes/db/pvc.yaml', 'kubernetes/ingress.yaml']) {
    const resource = byPath.get(path);
    assert.ok(resource, `expected generated file at ${path}`);
    assert.equal(resource.metadata.labels[PROJECT_ID_LABEL], project.id, `${path} is missing the project-id label`);
  }
});

test('two different projects that happen to produce identically-named services get distinct ownership label values', () => {
  const projectA = { id: '01a037bf-0000-7000-a000-000000000001', name: 'shop' };
  const projectB = { id: '01a037bf-0000-7000-a000-000000000002', name: 'shop' };
  const [fileA] = generateKubernetesManifests(spec, projectA);
  const [fileB] = generateKubernetesManifests(spec, projectB);
  const labelsA = labelsOf(fileA.contents);
  const labelsB = labelsOf(fileB.contents);
  assert.notEqual(labelsA[PROJECT_ID_LABEL], labelsB[PROJECT_ID_LABEL]);
});
