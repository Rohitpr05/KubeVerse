import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterState } from './cluster-state.js';
import { MANAGED_BY_LABEL, MANAGED_BY_VALUE, PROJECT_ID_LABEL } from './ownership.js';

const PROJECT_A = 'project-a';

function withOwnership(labels: Record<string, string> = {}): Record<string, string> {
  return { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE, [PROJECT_ID_LABEL]: PROJECT_A, ...labels };
}

// Builds a ClusterState populated the same way the real observer populates
// one - through replace()/apply()/applyEvent() with raw-shaped Kubernetes
// objects - covering a realistic "one KubeVerse project alongside unrelated
// cluster infrastructure" scenario:
//   - node-1 hosts the project's Pod; node-2 hosts an unrelated kube-system Pod.
//   - the project's Namespace/Pod/Service carry ownership labels; kube-system's
//     Namespace/Pod do not (and never will, since KubeVerse never generates them).
function buildFixture() {
  const updates: unknown[] = [];
  const state = new ClusterState((update) => updates.push(update));

  state.replace('Node', [
    { metadata: { uid: 'node-1', name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
    { metadata: { uid: 'node-2', name: 'node-2' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
  ]);

  state.replace('Namespace', [
    { metadata: { uid: 'ns-project', name: 'kubeverse-shop', labels: withOwnership() }, status: { phase: 'Active' } },
    { metadata: { uid: 'ns-kube-system', name: 'kube-system' }, status: { phase: 'Active' } },
  ]);

  state.replace('Pod', [
    {
      metadata: { uid: 'pod-project', name: 'backend-abc123', namespace: 'kubeverse-shop', labels: withOwnership({ app: 'backend' }) },
      spec: { nodeName: 'node-1', containers: [{ name: 'backend' }] },
      status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
    },
    {
      metadata: { uid: 'pod-coredns', name: 'coredns-xyz789', namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } },
      spec: { nodeName: 'node-2', containers: [{ name: 'coredns' }] },
      status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
    },
  ]);

  state.replace('Service', [
    { metadata: { uid: 'svc-project', name: 'backend', namespace: 'kubeverse-shop', labels: withOwnership({ app: 'backend' }) }, spec: { selector: { app: 'backend' } } },
  ]);

  state.replaceEvents([
    { metadata: { uid: 'evt-project', name: 'backend.evt1', namespace: 'kubeverse-shop' }, involvedObject: { uid: 'pod-project', kind: 'Pod', name: 'backend-abc123' }, type: 'Normal', reason: 'Started', message: 'Started container backend', lastTimestamp: '2026-01-01T00:00:01Z' },
    { metadata: { uid: 'evt-coredns', name: 'coredns.evt1', namespace: 'kube-system' }, involvedObject: { uid: 'pod-coredns', kind: 'Pod', name: 'coredns-xyz789' }, type: 'Normal', reason: 'Started', message: 'Started container coredns', lastTimestamp: '2026-01-01T00:00:01Z' },
  ]);

  return { state, updates };
}

test('projectResources includes only project-owned resources plus the Node(s) actually hosting the project\'s Pods', () => {
  const { state } = buildFixture();
  const resources = state.projectResources(PROJECT_A);
  const byKindAndName = new Set(resources.map((r) => `${r.kind}:${r.name}`));

  assert.ok(byKindAndName.has('Namespace:kubeverse-shop'));
  assert.ok(byKindAndName.has('Pod:backend-abc123'));
  assert.ok(byKindAndName.has('Service:backend'));
  assert.ok(byKindAndName.has('Node:node-1'), 'node-1 hosts the project Pod and must be included');

  assert.ok(!byKindAndName.has('Namespace:kube-system'), 'unrelated Namespace must never appear');
  assert.ok(!byKindAndName.has('Pod:coredns-xyz789'), 'unrelated Pod must never appear');
  assert.ok(!byKindAndName.has('Node:node-2'), 'node-2 only hosts an unrelated Pod and must be excluded');
});

test('isResourceOwnedByProject: a Node is relevant only if it currently hosts a project Pod', () => {
  const { state } = buildFixture();
  const node1 = state.projectResources(PROJECT_A).find((r) => r.kind === 'Node' && r.name === 'node-1');
  const allNodes = state.resources({ kind: 'Node' });
  const node2 = allNodes.find((r) => r.name === 'node-2');

  assert.ok(node1);
  assert.equal(state.isResourceOwnedByProject(node1, PROJECT_A), true);
  assert.equal(state.isResourceOwnedByProject(node2, PROJECT_A), false);
});

test('isResourceOwnedByProject never matches a different or missing project id (no loose/partial matching)', () => {
  const { state } = buildFixture();
  const pod = state.projectResources(PROJECT_A).find((r) => r.kind === 'Pod');
  assert.ok(pod);
  assert.equal(state.isResourceOwnedByProject(pod, 'some-other-project'), false);
  const unrelatedPod = state.resources({ kind: 'Pod' }).find((r) => r.name === 'coredns-xyz789');
  assert.equal(state.isResourceOwnedByProject(unrelatedPod, PROJECT_A), false);
});

test('projectSnapshot includes only events whose involved object belongs to the project', () => {
  const { state } = buildFixture();
  const snapshot = state.projectSnapshot(PROJECT_A);
  const reasons = snapshot.events.map((event) => event.involvedName);
  assert.deepEqual(reasons, ['backend-abc123']);
});

test('projectSnapshot statistics are scoped to the project (not the whole cluster)', () => {
  const { state } = buildFixture();
  const snapshot = state.projectSnapshot(PROJECT_A);
  assert.equal(snapshot.statistics.totalPods, 1);
  assert.equal(snapshot.statistics.totalNodes, 1);
});

test('projectGraph still resolves a scheduled_on edge between the included Pod and its Node', () => {
  const { state } = buildFixture();
  const graph = state.projectGraph(PROJECT_A);
  const pod = graph.nodes.find((n) => n.kind === 'Pod');
  const node = graph.nodes.find((n) => n.kind === 'Node');
  assert.ok(pod && node);
  assert.ok(graph.edges.some((edge) => edge.relation === 'scheduled_on' && edge.source === node!.resourceUid && edge.target === pod!.resourceUid));
});

test('a resource update for another project is not owned by the active project (broadcast-filtering building block)', () => {
  const { state } = buildFixture();
  const unrelatedNamespace = state.resources({ kind: 'Namespace' }).find((r) => r.name === 'kube-system');
  assert.ok(unrelatedNamespace);
  assert.equal(state.isResourceOwnedByProject(unrelatedNamespace, PROJECT_A), false);
});
