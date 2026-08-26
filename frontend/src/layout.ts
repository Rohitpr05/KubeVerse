// Deterministic hierarchical layout for the Playground topology. Pure
// function of the backend-derived ResourceGraph - no randomness, no
// hardcoded resource names, no second graph/state system. Operates purely
// on the *relations* the backend already computed (owns/runs/contains/
// selects/mounts/routes_to/bound_to/uses - see backend/src/resource-graph.ts),
// never on specific kind or resource names.
//
// Approach: a classic recursive subtree layout (in the spirit of
// Reingold-Tilford tree drawing, simplified for this graph's shape).
// X comes from a fixed kind->column mapping (left-to-right hierarchy:
// Namespace -> Deployment -> ReplicaSet -> Pod -> Container). Y is assigned
// by recursively laying out each node's owns/runs children first, then
// centering the parent over the vertical span its children occupy - so a
// Deployment ends up vertically centered next to its ReplicaSet and Pods,
// and unrelated workloads never share row space. Side-lane resources
// (Service/ConfigMap/Secret/PVC not part of any owns-tree) are anchored
// near whatever they reference (selects/mounts/routes_to/bound_to/uses) when
// one can be found, so related resources stay visually grouped.
import type { ResourceGraph } from '@kubeverse/shared';

export interface Point { x: number; y: number; }

const ROW_HEIGHT = 112;
const ROOT_GAP_ROWS = 1.25;
const NAMESPACE_GAP_ROWS = 2;
const SIDE_LANE_GAP_ROWS = 0.5;

// Matches graph.ts's NODE_HEIGHT (70) with a margin - the minimum vertical
// gap enforced between any two nodes that land in the same column (see
// resolveColumnOverlaps). A side-lane resource is anchored to whatever it
// references (see findAnchorRoot below) by reusing that anchor's Y, which
// can coincide exactly with another tree node already at the same column
// (e.g. a Deployment centered over its one ReplicaSet child shares that
// ReplicaSet's Y - a PersistentVolumeClaim anchored to the Deployment then
// shares both the ReplicaSet's column AND Y). Rather than special-casing
// every way that can happen, every position computed above is provisional
// until this gap is enforced once, per column, at the end.
const MIN_COLUMN_GAP = 90;

const HIERARCHY_RELATIONS = new Set(['owns', 'runs']);
const CROSS_LINK_RELATIONS = new Set(['selects', 'mounts', 'routes_to', 'bound_to', 'uses']);

const columns: Record<string, number> = {
  Node: 0, Namespace: 240, Ingress: 520, Service: 520, Deployment: 520, DaemonSet: 520, StatefulSet: 520,
  Job: 520, CronJob: 520, ReplicaSet: 820, Pod: 1120, Container: 1420, ConfigMap: 520, Secret: 520,
  PersistentVolumeClaim: 820, PersistentVolume: 1120, StorageClass: 520,
};

function columnFor(kind: string | undefined): number {
  return (kind ? columns[kind] : undefined) ?? 520;
}

export function computeLayout(graph: ResourceGraph): Map<string, Point> {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ownsChildren = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const containsByNamespace = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (HIERARCHY_RELATIONS.has(edge.relation)) {
      if (!ownsChildren.has(edge.source)) ownsChildren.set(edge.source, []);
      ownsChildren.get(edge.source)!.push(edge.target);
      parentOf.set(edge.target, edge.source);
    }
    if (edge.relation === 'contains') {
      if (!containsByNamespace.has(edge.source)) containsByNamespace.set(edge.source, []);
      containsByNamespace.get(edge.source)!.push(edge.target);
    }
  }
  const labelOf = (id: string) => nodesById.get(id)?.label ?? '';
  for (const children of ownsChildren.values()) children.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

  const positions = new Map<string, Point>();

  // Lays out `id`'s owns/runs subtree starting at row `startRow`; returns the
  // number of rows the subtree consumed. Leaves take exactly one row;
  // ancestors are centered over the span their children occupy.
  function place(id: string, startRow: number): number {
    const x = columnFor(nodesById.get(id)?.kind);
    const children = ownsChildren.get(id);
    if (!children || children.length === 0) {
      positions.set(id, { x, y: startRow * ROW_HEIGHT });
      return 1;
    }
    let row = startRow;
    let firstChildY: number | undefined;
    let lastChildY = 0;
    for (const childId of children) {
      const consumed = place(childId, row);
      lastChildY = positions.get(childId)!.y;
      if (firstChildY === undefined) firstChildY = lastChildY;
      row += consumed;
    }
    positions.set(id, { x, y: (firstChildY! + lastChildY) / 2 });
    return row - startRow;
  }

  function findAnchorRoot(id: string): string | undefined {
    const link = graph.edges.find((edge) => CROSS_LINK_RELATIONS.has(edge.relation) && (edge.source === id || edge.target === id));
    if (!link) return undefined;
    let current = link.source === id ? link.target : link.source;
    while (parentOf.has(current)) current = parentOf.get(current)!;
    return positions.has(current) ? current : undefined;
  }

  const namespaceNodes = [...graph.nodes].filter((node) => node.kind === 'Namespace').sort((a, b) => a.label.localeCompare(b.label));
  let namespaceStartRow = 0;
  for (const namespaceNode of namespaceNodes) {
    positions.set(namespaceNode.id, { x: columnFor('Namespace'), y: namespaceStartRow * ROW_HEIGHT });
    const containedIds = containsByNamespace.get(namespaceNode.id) ?? [];
    const roots = containedIds.filter((id) => (ownsChildren.get(id)?.length ?? 0) > 0).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    const rootSet = new Set(roots);
    const sideLane = containedIds.filter((id) => !rootSet.has(id) && !parentOf.has(id)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

    let row = namespaceStartRow;
    for (const rootId of roots) row += place(rootId, row) + ROOT_GAP_ROWS;

    for (const sideId of sideLane) {
      const anchor = findAnchorRoot(sideId);
      if (anchor) {
        positions.set(sideId, { x: columnFor(nodesById.get(sideId)?.kind), y: positions.get(anchor)!.y });
      } else {
        positions.set(sideId, { x: columnFor(nodesById.get(sideId)?.kind), y: row * ROW_HEIGHT });
        row += 1 + SIDE_LANE_GAP_ROWS;
      }
    }
    namespaceStartRow += Math.max(1, row - namespaceStartRow) + NAMESPACE_GAP_ROWS;
  }

  // Cluster-scoped Nodes (not namespaced, so never reached via 'contains'
  // above) get their own band after every namespace.
  const clusterNodes = [...graph.nodes].filter((node) => node.kind === 'Node').sort((a, b) => a.label.localeCompare(b.label));
  clusterNodes.forEach((node, index) => positions.set(node.id, { x: columnFor('Node'), y: (namespaceStartRow + index) * ROW_HEIGHT }));
  namespaceStartRow += clusterNodes.length + NAMESPACE_GAP_ROWS;

  // Anything else with no relation to the namespace/owns tree at all
  // (e.g. a cluster-scoped PersistentVolume/StorageClass with no contains
  // edge) still gets a deterministic position rather than being silently
  // dropped from the layout.
  let fallbackRow = namespaceStartRow;
  for (const node of graph.nodes) {
    if (positions.has(node.id)) continue;
    positions.set(node.id, { x: columnFor(node.kind), y: fallbackRow * ROW_HEIGHT });
    fallbackRow += 1;
  }

  resolveOverlaps(positions);
  return positions;
}

// Final safety net (not a primary placement strategy): guarantees no two
// nodes sharing a column ever end up within MIN_COLUMN_GAP of each other,
// regardless of how their Y was originally derived (tree centering vs
// anchor-to-root). Only ever pushes a node further down from where it
// already was - it never touches X - so it can't undo the left-to-right
// hierarchy or namespace grouping above, only spread out a column's own rows
// when two of its entries would otherwise collide.
//
// `fixed`, when given, marks node ids whose position must never be changed -
// used by graph.ts's reconcileNodes, which freezes every already-on-screen
// node's position (Task 2: live updates must never move existing nodes) and
// only asks this function to find non-colliding spots for the *new* nodes a
// fresh computeLayout() pass proposed. Without this, a brand-new node
// inserted next to nodes that stayed frozen from an earlier layout could
// land exactly on top of one of them, since a fresh layout pass has no idea
// where the frozen nodes currently sit on screen. A column's fixed nodes are
// never moved to make room; only unfixed nodes are ever pushed down past
// them, which keeps the invariant that a set of already-resolved positions
// stays collision-free after inserting more nodes.
export function resolveOverlaps(positions: Map<string, Point>, fixed?: Set<string>): void {
  const byColumn = new Map<number, string[]>();
  for (const [id, point] of positions) {
    if (!byColumn.has(point.x)) byColumn.set(point.x, []);
    byColumn.get(point.x)!.push(id);
  }
  for (const ids of byColumn.values()) {
    ids.sort((a, b) => positions.get(a)!.y - positions.get(b)!.y);
    for (let i = 1; i < ids.length; i += 1) {
      const previous = positions.get(ids[i - 1])!;
      const current = positions.get(ids[i])!;
      const minY = previous.y + MIN_COLUMN_GAP;
      if (current.y < minY && !fixed?.has(ids[i])) positions.set(ids[i], { x: current.x, y: minY });
    }
  }
}
