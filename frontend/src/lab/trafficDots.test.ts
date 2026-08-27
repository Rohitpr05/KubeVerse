import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from '@xyflow/react';
import type { ClusterResource, ResourceGraph } from '@kubeverse/shared';
import { layoutAllNodes, buildExplorerEdges, type ExplorerNode } from '../graph.js';
import { computeNewDots, dotCountForSent, edgeBetween, findNodeId, REQUESTS_PER_DOT } from './trafficDots.js';

function resource(overrides: Partial<ClusterResource>): ClusterResource {
  return { uid: 'r-1', kind: 'Pod', name: 'r', namespace: 'ns', status: 'Running', labels: {}, annotations: {}, conditions: [], references: [], ...overrides };
}

// A Service selecting two Pods - the same shape backend/src/resource-graph.ts
// produces for a real traffic target (Service --selects--> Pod).
function serviceWithPods(podNames: string[]): { svc: ClusterResource; pods: ClusterResource[]; nodes: ExplorerNode[]; graph: ResourceGraph } {
  const svc = resource({ uid: 'svc-1', kind: 'Service', name: 'backend' });
  const pods = podNames.map((name, i) => resource({ uid: `pod-${i}`, kind: 'Pod', name, status: 'Running (Ready)' }));
  const all = [svc, ...pods];
  const graph: ResourceGraph = {
    generatedAt: '',
    nodes: all.map((r) => ({ id: r.uid, resourceUid: r.uid, kind: r.kind, label: r.name, status: r.status, namespace: r.namespace })),
    edges: pods.map((pod) => ({ id: `selects:${svc.uid}:${pod.uid}`, source: svc.uid, target: pod.uid, relation: 'selects' })),
  };
  return { svc, pods, nodes: layoutAllNodes(all, graph), graph };
}

// --- Batching (Part 2 / Definition of Done #2-3) ---

test('dotCountForSent uses ceil(sent / 10)', () => {
  const cases: [number, number][] = [[0, 0], [1, 1], [10, 1], [11, 2], [19, 2], [20, 2], [50, 5], [99, 10], [100, 10], [101, 11], [200, 20], [203, 21]];
  for (const [sent, expected] of cases) assert.equal(dotCountForSent(sent), expected, `dotCountForSent(${sent})`);
});

test('REQUESTS_PER_DOT is 10, matching the spec\'s "1 dot = 10 requests"', () => {
  assert.equal(REQUESTS_PER_DOT, 10);
});

// --- Independence: visual dot count never reduces/changes the real count ---

test('dotCountForSent is a pure read of `sent` - it takes no requests-per-second or configured-total input, so it cannot alter real traffic generation', () => {
  assert.equal(dotCountForSent.length, 1);
});

test('100 real requests produce exactly 10 total dots, and 200 real requests produce exactly 20 - independent of how the growth is chunked across ticks', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a']);

  function totalDotsOverRun(finalSent: number, chunk: number): number {
    let cursor = 0;
    let previousSent = 0;
    let spawned = 0;
    // Mirrors how real progress ticks arrive: irregular-sized increments
    // that don't necessarily divide the total evenly, always finishing
    // exactly at `finalSent` (the last, possibly-partial tick).
    while (previousSent < finalSent) {
      const sent = Math.min(finalSent, previousSent + chunk);
      const { dots, cursor: nextCursor } = computeNewDots({
        experimentId: 'exp-1', previousSent, nextSent: sent, targetPods: ['backend-a'],
        sourceNodeId: svc.uid, namespace: 'ns', edges: buildExplorerEdges(graph), nodes, ok: true,
        cursor, now: 0, spanMs: 300,
      });
      spawned += dots.length;
      cursor = nextCursor;
      previousSent = sent;
    }
    return spawned;
  }

  assert.equal(totalDotsOverRun(100, 7), 10);
  assert.equal(totalDotsOverRun(200, 3), 20);
  assert.equal(totalDotsOverRun(203, 11), 21);
});

// --- Edge usage / direction (Part 4/6/8/9) ---

test('a dot for a Service->Pod traffic target uses the real "selects" edge between them, never a fabricated one', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a']);
  const edges = buildExplorerEdges(graph);
  const { dots } = computeNewDots({
    experimentId: 'exp-1', previousSent: 0, nextSent: 10, targetPods: ['backend-a'],
    sourceNodeId: svc.uid, namespace: 'ns', edges, nodes, ok: true, cursor: 0, now: 0, spanMs: 300,
  });
  assert.equal(dots.length, 1);
  const edge = edges.find((e) => e.id === dots[0].edgeId);
  assert.ok(edge, 'the dot must reference an edge that actually exists in the graph');
  assert.equal(edge!.source, svc.uid, 'the edge must originate at the Service (the real traffic source)');
  assert.equal(edge!.target, findNodeId(nodes, 'Pod', 'ns', 'backend-a'), 'the edge must end at the targeted Pod');
});

test('no dot is produced when there is no real edge connecting the source to the resolved target Pod', () => {
  const { nodes, graph } = serviceWithPods(['backend-a']);
  const edges = buildExplorerEdges(graph);
  const { dots } = computeNewDots({
    experimentId: 'exp-1', previousSent: 0, nextSent: 10, targetPods: ['backend-a'],
    sourceNodeId: 'not-a-real-node', namespace: 'ns', edges, nodes, ok: true, cursor: 0, now: 0, spanMs: 300,
  });
  assert.deepEqual(dots, []);
});

test('multiple target Pods are round-robined across dots via the cursor, each still resolving to its own real edge', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a', 'backend-b']);
  const edges = buildExplorerEdges(graph);
  const { dots } = computeNewDots({
    experimentId: 'exp-1', previousSent: 0, nextSent: 20, targetPods: ['backend-a', 'backend-b'],
    sourceNodeId: svc.uid, namespace: 'ns', edges, nodes, ok: true, cursor: 0, now: 0, spanMs: 300,
  });
  assert.equal(dots.length, 2);
  const targets = dots.map((dot) => edges.find((e) => e.id === dot.edgeId)?.target);
  assert.deepEqual(new Set(targets), new Set([findNodeId(nodes, 'Pod', 'ns', 'backend-a'), findNodeId(nodes, 'Pod', 'ns', 'backend-b')]));
});

// --- No stale coordinates (Part 5/13/14) ---

test('a dot only ever carries an edge id, never a coordinate - so it can never go stale when a node moves or Auto Layout runs', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a']);
  const { dots } = computeNewDots({
    experimentId: 'exp-1', previousSent: 0, nextSent: 10, targetPods: ['backend-a'],
    sourceNodeId: svc.uid, namespace: 'ns', edges: buildExplorerEdges(graph), nodes, ok: true, cursor: 0, now: 0, spanMs: 300,
  });
  assert.equal(dots.length, 1);
  assert.deepEqual(Object.keys(dots[0]).sort(), ['edgeId', 'id', 'ok', 'startedAt']);
});

// --- Dot distribution (Part 12) ---

test('a burst of several dots spawned in one tick gets distinct, increasing start times spread across the tick span, not one identical timestamp', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a']);
  const { dots } = computeNewDots({
    experimentId: 'exp-1', previousSent: 0, nextSent: 50, targetPods: ['backend-a'],
    sourceNodeId: svc.uid, namespace: 'ns', edges: buildExplorerEdges(graph), nodes, ok: true, cursor: 0, now: 1000, spanMs: 300,
  });
  assert.equal(dots.length, 5);
  const starts = dots.map((dot) => dot.startedAt);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'start times must be non-decreasing');
  assert.equal(new Set(starts).size, starts.length, 'every dot in the burst must get its own start time');
  for (const start of starts) assert.ok(start >= 1000 && start < 1300, `start time ${start} must fall within the tick span`);
});

// --- Project isolation (Part 15): the function is pure/stateless, so a
// fresh experiment (fresh previousSent/cursor, as PlaygroundView resets on
// project switch) can never inherit another experiment's accumulated state.

test('resetting previousSent/cursor for a new experiment starts a fresh dot sequence, independent of any prior experiment', () => {
  const { svc, nodes, graph } = serviceWithPods(['backend-a']);
  const edges = buildExplorerEdges(graph);
  const first = computeNewDots({ experimentId: 'exp-A', previousSent: 190, nextSent: 200, targetPods: ['backend-a'], sourceNodeId: svc.uid, namespace: 'ns', edges, nodes, ok: true, cursor: 19, now: 0, spanMs: 300 });
  assert.equal(first.dots.length, 1);

  const second = computeNewDots({ experimentId: 'exp-B', previousSent: 0, nextSent: 10, targetPods: ['backend-a'], sourceNodeId: svc.uid, namespace: 'ns', edges, nodes, ok: true, cursor: 0, now: 0, spanMs: 300 });
  assert.equal(second.dots.length, 1);
  assert.notEqual(second.dots[0].id, first.dots[0].id);
  assert.ok(second.dots[0].id.startsWith('exp-B:'));
});

test('findNodeId and edgeBetween never invent a match for a resource/edge that does not exist', () => {
  const { nodes, graph } = serviceWithPods(['backend-a']);
  assert.equal(findNodeId(nodes, 'Pod', 'ns', 'does-not-exist'), undefined);
  assert.equal(edgeBetween(buildExplorerEdges(graph), 'nope', 'also-nope'), undefined);
});
