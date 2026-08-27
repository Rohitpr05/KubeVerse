// Turns real traffic-experiment progress into a bounded set of visual
// dots that travel along the existing React Flow topology (Phase 3A). This
// module is deliberately pure/stateless - no DOM, no timers - so the
// batching math and edge selection can be unit-tested directly; the actual
// per-frame animation (reading the live rendered SVG edge path) lives in
// TrafficParticles.tsx, which is the only place that touches the DOM.
//
// The visual layer is illustrative only, same discipline as the aggregated
// particles it replaces: the real, authoritative counts (sent/succeeded/
// failed/RPS) are shown numerically elsewhere (ActivityStrip) and are never
// derived from - or fed back into - anything computed here.
import type { Edge } from '@xyflow/react';
import type { ExplorerNode } from '../graph';

// 1 visual dot = 10 actual requests, rounded up so any progress at all
// (even a single request) eventually renders as a dot rather than silently
// vanishing below a threshold that's never reached for a small run.
export const REQUESTS_PER_DOT = 10;

export function dotCountForSent(sent: number): number {
  return Math.ceil(Math.max(0, sent) / REQUESTS_PER_DOT);
}

// How long one dot takes to travel the full length of its edge. Shared
// between TrafficParticles.tsx (which uses it to compute a dot's current
// position each animation frame) and PlaygroundView.tsx (which uses it to
// know when a dot has finished travelling and can be dropped from state).
export const DOT_TRAVEL_MS = 900;

export function findNodeId(nodes: ExplorerNode[], kind: string, namespace: string | undefined, name: string): string | undefined {
  return nodes.find((node) => node.data.resource.kind === kind && node.data.resource.namespace === namespace && node.data.resource.name === name)?.id;
}

// Never invents a route: only ever returns an edge that already exists in
// the current React-Flow-owned edge list (built by graph.ts's
// buildExplorerEdges straight from the backend's ResourceGraph). Direction
// comes entirely from the edge's own source/target - a Service->Pod
// 'selects' edge (backend/src/resource-graph.ts) is always recorded with
// the Service as source, so following the edge from its start (length 0)
// toward its end (full length) is automatically the correct direction, with
// no direction logic duplicated here.
export function edgeBetween(edges: Edge[], sourceId: string, targetId: string): Edge | undefined {
  return edges.find((edge) => edge.source === sourceId && edge.target === targetId);
}

// A dot only ever carries an edge id (and timing/outcome) - never a
// coordinate. Position is always sampled fresh, at render time, from
// whichever edge geometry is actually on screen right now (Part 13/14) -
// there is no x/y here to go stale when a node is dragged or Auto Layout
// runs.
export interface TrafficDot {
  id: string;
  edgeId: string;
  ok: boolean;
  startedAt: number;
}

export interface ComputeNewDotsParams {
  experimentId: string;
  previousSent: number;
  nextSent: number;
  targetPods: string[];
  sourceNodeId: string | undefined;
  namespace: string;
  edges: Edge[];
  nodes: ExplorerNode[];
  ok: boolean;
  cursor: number;
  now: number;
  spanMs: number;
}

// Converts the growth in a traffic experiment's real cumulative `sent`
// count (previousSent -> nextSent) into the new dots that growth is worth,
// using dotCountForSent's ceil(sent/10) on both ends so the total number of
// dots ever spawned over a whole run - however that growth happens to be
// chunked across progress ticks - always lands on exactly ceil(total/10)
// (Part 2). New dots are round-robined across `targetPods` (the same live,
// currently-Ready endpoints the backend is actually sending to - Part 8/14)
// and their `startedAt` is spread across `spanMs` (roughly one backend
// progress-tick interval) so they form a stream instead of a clump (Part 12).
export function computeNewDots(params: ComputeNewDotsParams): { dots: TrafficDot[]; cursor: number } {
  const { experimentId, previousSent, nextSent, targetPods, sourceNodeId, namespace, edges, nodes, ok, now, spanMs } = params;
  let cursor = params.cursor;
  if (!sourceNodeId || targetPods.length === 0) return { dots: [], cursor };

  const previousDots = dotCountForSent(previousSent);
  const nextDots = dotCountForSent(nextSent);
  const newDotCount = Math.max(0, nextDots - previousDots);
  const dots: TrafficDot[] = [];

  for (let i = 0; i < newDotCount; i += 1) {
    const podName = targetPods[cursor % targetPods.length];
    cursor += 1;
    const targetNodeId = findNodeId(nodes, 'Pod', namespace, podName);
    if (!targetNodeId) continue;
    const edge = edgeBetween(edges, sourceNodeId, targetNodeId);
    if (!edge) continue;
    dots.push({ id: `${experimentId}:${previousDots + i}`, edgeId: edge.id, ok, startedAt: now + (i * spanMs) / newDotCount });
  }
  return { dots, cursor };
}
