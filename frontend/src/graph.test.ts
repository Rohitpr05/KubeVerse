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

// Regression test: reconcileNodes previously placed a brand-new node using a
// *fresh* full-graph layout pass, which has no idea where already-on-screen
// (frozen) nodes currently sit - so the new node's fresh-layout position
// could land exactly on top of a frozen one. Reproduced live via the Lab's
// "Fail Pod" experiment (a real replacement Pod, inserted into an otherwise
// untouched topology) - fixed by resolveOverlaps() in layout.ts.
test('reconcileNodes never lets a newly-inserted node overlap an existing frozen node, even inside an owns-tree', () => {
  const deployment: ClusterResource = { uid: 'dep-1', kind: 'Deployment', name: 'echo-api', namespace: 'ns', status: '1/2 Ready', labels: {}, annotations: {}, conditions: [], references: [] };
  const replicaSet: ClusterResource = { uid: 'rs-1', kind: 'ReplicaSet', name: 'echo-api-abc', namespace: 'ns', status: '1/2 Ready', labels: {}, annotations: {}, conditions: [], references: [], owner: { uid: 'dep-1', kind: 'Deployment', name: 'echo-api' } };
  const podOne = pod({ uid: 'pod-1', name: 'echo-api-abc-1', status: 'Running (Ready)', owner: { uid: 'rs-1', kind: 'ReplicaSet', name: 'echo-api-abc' } });

  const graphWithOnePod: ResourceGraph = {
    generatedAt: '', nodes: [deployment, replicaSet, podOne].map((resource) => ({ id: resource.uid, resourceUid: resource.uid, kind: resource.kind, label: resource.name, status: resource.status, namespace: resource.namespace })),
    edges: [
      { id: 'e1', source: 'dep-1', target: 'rs-1', relation: 'owns' },
      { id: 'e2', source: 'rs-1', target: 'pod-1', relation: 'owns' },
    ],
  };
  const onScreen = layoutAllNodes([deployment, replicaSet, podOne], graphWithOnePod);
  // Simulate the frozen state right after the deployment centered itself
  // over its single child, as computeLayout's tree-centering naturally does.
  const podOnePosition = onScreen.find((node) => node.id === 'pod-1')!.position;
  const deploymentPosition = onScreen.find((node) => node.id === 'dep-1')!.position;

  const podTwo = pod({ uid: 'pod-2', name: 'echo-api-abc-2', status: 'Pending', owner: { uid: 'rs-1', kind: 'ReplicaSet', name: 'echo-api-abc' } });
  const graphWithTwoPods: ResourceGraph = {
    generatedAt: '', nodes: [deployment, replicaSet, podOne, podTwo].map((resource) => ({ id: resource.uid, resourceUid: resource.uid, kind: resource.kind, label: resource.name, status: resource.status, namespace: resource.namespace })),
    edges: [
      { id: 'e1', source: 'dep-1', target: 'rs-1', relation: 'owns' },
      { id: 'e2', source: 'rs-1', target: 'pod-1', relation: 'owns' },
      { id: 'e3', source: 'rs-1', target: 'pod-2', relation: 'owns' },
    ],
  };
  const reconciled = reconcileNodes(onScreen, [deployment, replicaSet, podOne, podTwo], graphWithTwoPods);

  const finalPodOne = reconciled.find((node) => node.id === 'pod-1')!;
  const finalDeployment = reconciled.find((node) => node.id === 'dep-1')!;
  assert.deepEqual(finalPodOne.position, podOnePosition, 'the existing Pod must not move');
  assert.deepEqual(finalDeployment.position, deploymentPosition, 'the existing Deployment must not move');

  const finalPodTwo = reconciled.find((node) => node.id === 'pod-2')!;
  const overlapsX = Math.abs(finalPodTwo.position.x - finalPodOne.position.x) < 190;
  const overlapsY = Math.abs(finalPodTwo.position.y - finalPodOne.position.y) < 70;
  assert.ok(!(overlapsX && overlapsY), `newly-inserted pod-2 at (${finalPodTwo.position.x},${finalPodTwo.position.y}) must not overlap frozen pod-1 at (${finalPodOne.position.x},${finalPodOne.position.y})`);
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
