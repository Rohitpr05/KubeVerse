// The frontend only lays out graph data projected by the backend; it never
// resolves Kubernetes relationships itself - see layout.ts for the actual
// position algorithm. This module only shapes backend data into React Flow
// nodes/edges and decides what's currently visible; it never invents graph
// structure.
import type { CSSProperties } from 'react';
import type { ClusterKind, ClusterResource, ResourceGraph } from '@kubeverse/shared';
import type { Edge, Node } from '@xyflow/react';
import { computeLayout, resolveOverlaps, type Point } from './layout';

export type ExplorerNodeData = { resource: ClusterResource };
export type ExplorerNode = Node<ExplorerNodeData, 'resource'>;

const palette: Record<ClusterKind, string> = {
  Namespace: '#1d4ed8', Node: '#475569', Deployment: '#7c3aed', ReplicaSet: '#a21caf', Pod: '#0f766e', Container: '#b45309',
  Service: '#0369a1', Ingress: '#0e7490', DaemonSet: '#6d28d9', StatefulSet: '#9333ea', Job: '#be123c', CronJob: '#c2410c',
  ConfigMap: '#047857', Secret: '#b91c1c', PersistentVolume: '#4f46e5', PersistentVolumeClaim: '#6366f1', StorageClass: '#4338ca'
};

// Matches .resource-node's fixed CSS size exactly (width: 190px; min-height:
// 70px, with no text wrapping so content never grows past that). Declaring
// this on the node objects themselves - not just via CSS - is required, not
// cosmetic: the MiniMap (and fitView bounds) only render/measure a node once
// React Flow considers it to "have dimensions"
// (node.measured?.width ?? node.width ?? node.initialWidth, see
// @xyflow/system's nodeHasDimensions/getNodeDimensions).
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 70;

function synthesized(node: ResourceGraph['nodes'][number]): ClusterResource {
  return { uid: node.resourceUid, kind: node.kind, name: node.label, namespace: node.namespace, status: node.status, labels: {}, annotations: {}, conditions: [], references: [] };
}

function buildNode(node: ResourceGraph['nodes'][number], resource: ClusterResource, position: Point): ExplorerNode {
  return {
    id: node.id, type: 'resource' as const,
    position, width: NODE_WIDTH, height: NODE_HEIGHT,
    data: { resource }, style: { '--accent': palette[node.kind] } as CSSProperties,
  };
}

export function buildExplorerEdges(graph: ResourceGraph | undefined): Edge[] {
  if (!graph) return [];
  return graph.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    label: ['selects', 'mounts', 'routes_to', 'bound_to', 'scheduled_on'].includes(edge.relation) ? edge.relation.replaceAll('_', ' ') : undefined,
    type: 'smoothstep', style: { stroke: edge.relation === 'selects' ? '#38bdf8' : '#64748b' },
  }));
}

// The full node list, freshly auto-laid-out from scratch - used for a brand
// new project and for the explicit "Auto Layout" action. Never used for
// ordinary data updates (see reconcileNodes), so it's the only place a full
// re-layout can happen.
export function layoutAllNodes(resources: ClusterResource[], graph: ResourceGraph): ExplorerNode[] {
  const resourceByUid = new Map(resources.map((resource) => [resource.uid, resource]));
  const positions = computeLayout(graph);
  return graph.nodes.map((node) => buildNode(node, resourceByUid.get(node.resourceUid) ?? synthesized(node), positions.get(node.id) ?? { x: 0, y: 0 }));
}

// Reconciles a fresh backend graph into whatever React-Flow-owned node list
// is currently on screen: a node that already exists keeps its exact
// position - whether it was auto-laid-out earlier or the user dragged it -
// and only gets fresh `data`/`style`; a node that no longer exists is
// dropped; a genuinely new node (e.g. the replacement Pod a Lab "Fail Pod"
// experiment's ReplicaSet creates) gets a position from one fresh layout
// pass over the *whole* graph (computed once, only when at least one new
// node actually needs it). A fresh layout pass has no idea where the
// existing, frozen nodes currently sit on screen though, so its proposed
// position for a new node could land on top of one of them - resolveOverlaps
// is run over the combined set (existing positions marked `fixed`, so only
// the new nodes can be nudged) to guarantee the result the same no-overlap
// contract layoutAllNodes already gives a fresh project, without moving
// anything already on screen. This is what makes both "Pod Running ->
// CrashLoopBackOff" (pure data update) and "Pod replaced by a new one"
// (one new node inserted cleanly) work without a full re-layout.
export function reconcileNodes(current: ExplorerNode[], resources: ClusterResource[], graph: ResourceGraph | undefined): ExplorerNode[] {
  if (!graph) return [];
  const resourceByUid = new Map(resources.map((resource) => [resource.uid, resource]));
  const currentById = new Map(current.map((node) => [node.id, node]));
  const newNodeIds = new Set(graph.nodes.filter((node) => !currentById.has(node.id)).map((node) => node.id));

  let positions: Map<string, Point> | undefined;
  if (newNodeIds.size > 0) {
    positions = computeLayout(graph);
    const fixed = new Set(currentById.keys());
    for (const [id, node] of currentById) positions.set(id, node.position);
    resolveOverlaps(positions, fixed);
  }

  return graph.nodes.map((node) => {
    const resource = resourceByUid.get(node.resourceUid) ?? synthesized(node);
    const existing = currentById.get(node.id);
    if (existing) return { ...existing, data: { resource }, style: { '--accent': palette[node.kind] } as CSSProperties };
    return buildNode(node, resource, positions?.get(node.id) ?? { x: 0, y: 0 });
  });
}

// Pure visibility filter over an already-positioned node list - never
// touches position, so toggling a kind filter or typing a search term can't
// move anything.
export function filterVisible(nodes: ExplorerNode[], edges: Edge[], allowedKinds: Set<string>, search: string): { nodes: ExplorerNode[]; edges: Edge[] } {
  const needle = search.toLowerCase();
  const visibleNodes = nodes.filter((node) => {
    const resource = node.data.resource;
    return allowedKinds.has(resource.kind) && (!needle || `${resource.name} ${resource.kind} ${resource.namespace ?? ''}`.toLowerCase().includes(needle));
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return { nodes: visibleNodes, edges: visibleEdges };
}
