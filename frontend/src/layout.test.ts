import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceGraph } from '@kubeverse/shared';
import { computeLayout } from './layout.js';

function graph(nodes: ResourceGraph['nodes'], edges: ResourceGraph['edges'] = []): ResourceGraph {
  return { generatedAt: '', nodes, edges };
}

// Node dimensions used across the Playground (see graph.ts) - two nodes
// "overlap" if both their X and Y spans intersect by more than this.
const NODE_WIDTH = 190;
const NODE_HEIGHT = 70;

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
}

function assertNoOverlaps(positions: Map<string, { x: number; y: number }>) {
  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      assert.ok(!overlaps(entries[i][1], entries[j][1]), `${entries[i][0]} and ${entries[j][0]} overlap at (${entries[i][1].x},${entries[i][1].y}) / (${entries[j][1].x},${entries[j][1].y})`);
    }
  }
}

test('a small 2-service topology (namespace + 2 deployments each with a replicaset/pod) has no overlapping nodes', () => {
  const g = graph(
    [
      { id: 'ns', resourceUid: 'ns', kind: 'Namespace', label: 'shop', status: 'Active' },
      { id: 'dep-a', resourceUid: 'dep-a', kind: 'Deployment', label: 'frontend', status: 'Ready' },
      { id: 'rs-a', resourceUid: 'rs-a', kind: 'ReplicaSet', label: 'frontend-1', status: 'Ready' },
      { id: 'pod-a', resourceUid: 'pod-a', kind: 'Pod', label: 'frontend-1-abc', status: 'Running' },
      { id: 'dep-b', resourceUid: 'dep-b', kind: 'Deployment', label: 'backend', status: 'Ready' },
      { id: 'rs-b', resourceUid: 'rs-b', kind: 'ReplicaSet', label: 'backend-1', status: 'Ready' },
      { id: 'pod-b', resourceUid: 'pod-b', kind: 'Pod', label: 'backend-1-abc', status: 'Running' },
    ],
    [
      { id: 'e1', source: 'ns', target: 'dep-a', relation: 'contains' },
      { id: 'e2', source: 'ns', target: 'dep-b', relation: 'contains' },
      { id: 'e3', source: 'dep-a', target: 'rs-a', relation: 'owns' },
      { id: 'e4', source: 'rs-a', target: 'pod-a', relation: 'owns' },
      { id: 'e5', source: 'dep-b', target: 'rs-b', relation: 'owns' },
      { id: 'e6', source: 'rs-b', target: 'pod-b', relation: 'owns' },
    ],
  );
  const positions = computeLayout(g);
  assert.equal(positions.size, 7);
  assertNoOverlaps(positions);

  // Left-to-right hierarchy: Namespace -> Deployment -> ReplicaSet -> Pod.
  assert.ok(positions.get('ns')!.x < positions.get('dep-a')!.x);
  assert.ok(positions.get('dep-a')!.x < positions.get('rs-a')!.x);
  assert.ok(positions.get('rs-a')!.x < positions.get('pod-a')!.x);

  // Two independent workloads land in separate rows, not stacked on the
  // same Y.
  assert.notEqual(positions.get('dep-a')!.y, positions.get('dep-b')!.y);
});

test('a medium topology (5 services, each with a service + configmap side-lane resource) has no overlapping nodes', () => {
  const nodes: ResourceGraph['nodes'] = [{ id: 'ns', resourceUid: 'ns', kind: 'Namespace', label: 'shop', status: 'Active' }];
  const edges: ResourceGraph['edges'] = [];
  for (let i = 0; i < 5; i += 1) {
    const dep = `dep-${i}`, rs = `rs-${i}`, pod = `pod-${i}`, svc = `svc-${i}`, cm = `cm-${i}`;
    nodes.push(
      { id: dep, resourceUid: dep, kind: 'Deployment', label: `svc-${i}`, status: 'Ready' },
      { id: rs, resourceUid: rs, kind: 'ReplicaSet', label: `svc-${i}-1`, status: 'Ready' },
      { id: pod, resourceUid: pod, kind: 'Pod', label: `svc-${i}-1-abc`, status: 'Running' },
      { id: svc, resourceUid: svc, kind: 'Service', label: `svc-${i}`, status: 'Active' },
      { id: cm, resourceUid: cm, kind: 'ConfigMap', label: `svc-${i}-config`, status: 'Active' },
    );
    edges.push(
      { id: `c-${dep}`, source: 'ns', target: dep, relation: 'contains' },
      { id: `c-${svc}`, source: 'ns', target: svc, relation: 'contains' },
      { id: `c-${cm}`, source: 'ns', target: cm, relation: 'contains' },
      { id: `o-${rs}`, source: dep, target: rs, relation: 'owns' },
      { id: `o-${pod}`, source: rs, target: pod, relation: 'owns' },
      { id: `s-${svc}`, source: svc, target: dep, relation: 'selects' },
    );
  }
  const positions = computeLayout(graph(nodes, edges));
  assert.equal(positions.size, nodes.length);
  assertNoOverlaps(positions);
});

test('a larger topology (10 workloads, PVCs, multiple namespaces) has no overlapping nodes', () => {
  const nodes: ResourceGraph['nodes'] = [];
  const edges: ResourceGraph['edges'] = [];
  for (let ns = 0; ns < 2; ns += 1) {
    const nsId = `ns-${ns}`;
    nodes.push({ id: nsId, resourceUid: nsId, kind: 'Namespace', label: `team-${ns}`, status: 'Active' });
    for (let i = 0; i < 5; i += 1) {
      const dep = `dep-${ns}-${i}`, rs = `rs-${ns}-${i}`, pvc = `pvc-${ns}-${i}`;
      const pods = [`pod-${ns}-${i}-0`, `pod-${ns}-${i}-1`, `pod-${ns}-${i}-2`];
      nodes.push(
        { id: dep, resourceUid: dep, kind: 'Deployment', label: `svc-${ns}-${i}`, status: 'Ready' },
        { id: rs, resourceUid: rs, kind: 'ReplicaSet', label: `svc-${ns}-${i}-1`, status: 'Ready' },
        { id: pvc, resourceUid: pvc, kind: 'PersistentVolumeClaim', label: `svc-${ns}-${i}-data`, status: 'Bound' },
        ...pods.map((id) => ({ id, resourceUid: id, kind: 'Pod' as const, label: id, status: 'Running' })),
      );
      edges.push(
        { id: `c-${dep}`, source: nsId, target: dep, relation: 'contains' },
        { id: `c-${pvc}`, source: nsId, target: pvc, relation: 'contains' },
        { id: `o-${rs}`, source: dep, target: rs, relation: 'owns' },
        ...pods.map((id) => ({ id: `o-${id}`, source: rs, target: id, relation: 'owns' as const })),
        { id: `m-${pvc}`, source: dep, target: pvc, relation: 'mounts' },
      );
    }
  }
  const positions = computeLayout(graph(nodes, edges));
  assert.equal(positions.size, nodes.length);
  assertNoOverlaps(positions);
});

test('computeLayout is deterministic: the same graph always produces the same positions', () => {
  const g = graph(
    [
      { id: 'ns', resourceUid: 'ns', kind: 'Namespace', label: 'shop', status: 'Active' },
      { id: 'dep', resourceUid: 'dep', kind: 'Deployment', label: 'backend', status: 'Ready' },
      { id: 'rs', resourceUid: 'rs', kind: 'ReplicaSet', label: 'backend-1', status: 'Ready' },
      { id: 'pod', resourceUid: 'pod', kind: 'Pod', label: 'backend-1-abc', status: 'Running' },
    ],
    [
      { id: 'e1', source: 'ns', target: 'dep', relation: 'contains' },
      { id: 'e2', source: 'dep', target: 'rs', relation: 'owns' },
      { id: 'e3', source: 'rs', target: 'pod', relation: 'owns' },
    ],
  );
  const first = computeLayout(g);
  const second = computeLayout(g);
  for (const [id, position] of first) assert.deepEqual(second.get(id), position, `${id} must land at the same position on every run`);
});

test('a resource unrelated to any namespace/owns tree (e.g. a cluster-scoped Node) still gets a position, never dropped', () => {
  const g = graph([{ id: 'node-1', resourceUid: 'node-1', kind: 'Node', label: 'worker-1', status: 'Ready' }]);
  const positions = computeLayout(g);
  assert.ok(positions.has('node-1'));
});

test('an empty graph produces an empty layout', () => {
  const positions = computeLayout(graph([]));
  assert.equal(positions.size, 0);
});
