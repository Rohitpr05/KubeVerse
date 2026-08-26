import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClusterResource, ResourceGraph } from '@kubeverse/shared';
import { layoutAllNodes, reconcileNodes, filterVisible, buildExplorerEdges } from './graph.js';

function pod(overrides: Partial<ClusterResource>): ClusterResource {
  return {
    uid: 'pod-1', kind: 'Pod', name: 'backend-abc', namespace: 'kubeverse-shop', status: 'Running',
    labels: {}, annotations: {}, conditions: [], references: [], ...overrides,
  };
}

function graphFor(resources: ClusterResource[]): ResourceGraph {
  return {
    generatedAt: '',
    nodes: resources.map((resource) => ({ id: resource.uid, resourceUid: resource.uid, kind: resource.kind, label: resource.name, status: resource.status, namespace: resource.namespace })),
    edges: [],
  };
}

const allKinds = new Set(['Pod', 'Deployment', 'ReplicaSet', 'Service', 'Namespace', 'Node']);

// Task 4/5: a Pod (or any resource) in an unhealthy/pending/failed state is
// still a real Kubernetes resource and must still produce a graph node - the
// graph is a topology/state graph, never a "healthy resources only" one.
for (const status of ['Pending', 'ImagePullBackOff', 'ErrImagePull', 'CrashLoopBackOff', 'Failed', 'Unknown', 'Running (Ready)']) {
  test(`a Pod with status "${status}" still produces a graph node`, () => {
    const resource = pod({ status });
    const nodes = layoutAllNodes([resource], graphFor([resource]));
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].data.resource.status, status);
  });
}

test('a Pod transitioning Running -> Pending remains represented by the same graph node id', () => {
  const running = pod({ status: 'Running (Ready)' });
  const runningNodes = layoutAllNodes([running], graphFor([running]));
  assert.equal(runningNodes.length, 1);

  const pending = pod({ status: 'Pending' });
  const pendingNodes = layoutAllNodes([pending], graphFor([pending]));
  assert.equal(pendingNodes.length, 1);
  assert.equal(pendingNodes[0].id, runningNodes[0].id, 'same resource uid -> same graph node id across a status change');
});

test('a Deployment/ReplicaSet/Pod cascade of mixed health never collapses the graph to empty', () => {
  const resources: ClusterResource[] = [
    { uid: 'deploy-1', kind: 'Deployment', name: 'backend', namespace: 'ns', status: '1/2 Ready', labels: {}, annotations: {}, conditions: [], references: [] },
    { uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', namespace: 'ns', status: '1/2 Ready', labels: {}, annotations: {}, conditions: [], references: [], owner: { uid: 'deploy-1', kind: 'Deployment', name: 'backend' } },
    pod({ uid: 'pod-1', status: 'Running (Ready)', owner: { uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc' } }),
    pod({ uid: 'pod-2', name: 'backend-def', status: 'FailedScheduling', owner: { uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc' } }),
  ];
  const nodes = layoutAllNodes(resources, graphFor(resources));
  assert.equal(nodes.length, 4, 'every resource in the cascade is still represented, healthy or not');
});

// Regression guard for the MiniMap bug: React Flow's MiniMap (and fitView)
// only render/measure a node once it "has dimensions"
// (node.measured?.width ?? node.width ?? node.initialWidth must be defined -
// see @xyflow/system's nodeHasDimensions). Without an explicit width/height
// on the node object itself, that depends on an async ResizeObserver-based
// measurement pass that was verified (against this exact dependency version,
// in a minimal reproduction) to never reliably complete, leaving the MiniMap
// permanently blank regardless of how long you wait. Every node this module
// produces must declare its real size up front.
test('every node produced has an explicit width/height, matching .resource-node\'s fixed CSS size', () => {
  const resource = pod({});
  const nodes = layoutAllNodes([resource], graphFor([resource]));
  assert.equal(nodes[0].width, 190);
  assert.equal(nodes[0].height, 70);
});

test('zero resources with a defined graph produces zero nodes (a genuine empty project)', () => {
  const nodes = layoutAllNodes([], graphFor([]));
  assert.deepEqual(nodes, []);
});

test('an undefined graph (not yet fetched) produces an empty result even when resources are present', () => {
  const resource = pod({});
  const nodes = reconcileNodes([], [resource], undefined);
  assert.deepEqual(nodes, []);
});

// Task 2/5: reconcileNodes must preserve the exact position of an existing
// node (whether auto-laid-out or user-dragged) and only touch its data when
// its status changes - this is the core "live updates don't move nodes"
// contract, and the "update data not recreate nodes" contract.
test('reconcileNodes preserves an existing node\'s position and only updates its data on a status change', () => {
  const running = pod({ status: 'Running (Ready)' });
  const initial = layoutAllNodes([running], graphFor([running]));
  const draggedPosition = { x: 999, y: 777 };
  const onScreen = [{ ...initial[0], position: draggedPosition }];

  const failing = pod({ status: 'CrashLoopBackOff' });
  const reconciled = reconcileNodes(onScreen, [failing], graphFor([failing]));

  assert.equal(reconciled.length, 1);
  assert.deepEqual(reconciled[0].position, draggedPosition, 'a manually-dragged position must survive a live status update');
  assert.equal(reconciled[0].data.resource.status, 'CrashLoopBackOff', 'data must still update in place');
});

test('reconcileNodes gives a genuinely new node a position without moving any existing node', () => {
  const existingResource = pod({ uid: 'pod-1' });
  const onScreen = layoutAllNodes([existingResource], graphFor([existingResource]));
  const existingPosition = { ...onScreen[0].position };

  const newResource = pod({ uid: 'pod-2', name: 'backend-def' });
  const nextGraph = graphFor([existingResource, newResource]);
  const reconciled = reconcileNodes(onScreen, [existingResource, newResource], nextGraph);

  assert.equal(reconciled.length, 2);
  const stillExisting = reconciled.find((node) => node.id === 'pod-1');
  assert.deepEqual(stillExisting?.position, existingPosition, 'an existing node must not move when a sibling is added');
  const added = reconciled.find((node) => node.id === 'pod-2');
  assert.ok(added, 'the new resource must produce a new node');
});

test('reconcileNodes drops a node whose resource no longer exists in the graph', () => {
  const resource = pod({});
  const onScreen = layoutAllNodes([resource], graphFor([resource]));
  const reconciled = reconcileNodes(onScreen, [], graphFor([]));
  assert.deepEqual(reconciled, []);
});

test('filterVisible hides resources of an unchecked kind without touching position', () => {
  const resource = pod({});
  const nodes = layoutAllNodes([resource], graphFor([resource]));
  const edges = buildExplorerEdges(graphFor([resource]));
  const { nodes: visible } = filterVisible(nodes, edges, new Set(['Deployment']), '');
  assert.deepEqual(visible, []);
  const { nodes: visibleAgain } = filterVisible(nodes, edges, allKinds, '');
  assert.deepEqual(visibleAgain[0].position, nodes[0].position);
});

test('filterVisible matches search against name, kind, and namespace', () => {
  const resource = pod({ name: 'checkout-worker' });
  const nodes = layoutAllNodes([resource], graphFor([resource]));
  const { nodes: matched } = filterVisible(nodes, [], allKinds, 'checkout');
  assert.equal(matched.length, 1);
  const { nodes: unmatched } = filterVisible(nodes, [], allKinds, 'nonexistent');
  assert.equal(unmatched.length, 0);
});
