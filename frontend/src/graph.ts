// The frontend only lays out graph data projected by the backend; it never resolves Kubernetes relationships itself.
import type { CSSProperties } from 'react';
import type { ClusterKind, ClusterResource, ResourceGraph } from '@simulator/shared/platform-contract';
import type { Edge, Node } from '@xyflow/react';

export type ExplorerNodeData = { resource: ClusterResource };
export type ExplorerNode = Node<ExplorerNodeData, 'resource'>;

const palette: Record<ClusterKind, string> = {
  Namespace: '#1d4ed8', Node: '#475569', Deployment: '#7c3aed', ReplicaSet: '#a21caf', Pod: '#0f766e', Container: '#b45309',
  Service: '#0369a1', Ingress: '#0e7490', DaemonSet: '#6d28d9', StatefulSet: '#9333ea', Job: '#be123c', CronJob: '#c2410c',
  ConfigMap: '#047857', Secret: '#b91c1c', PersistentVolume: '#4f46e5', PersistentVolumeClaim: '#6366f1', StorageClass: '#4338ca'
};
const columns: Partial<Record<ClusterKind, number>> = { Node: 0, Namespace: 220, Ingress: 470, Service: 470, Deployment: 470, DaemonSet: 470, StatefulSet: 470, Job: 470, CronJob: 470, ReplicaSet: 735, Pod: 1000, Container: 1265, ConfigMap: 470, Secret: 470, PersistentVolumeClaim: 735, PersistentVolume: 1000, StorageClass: 470 };
const laneOffsets: Partial<Record<ClusterKind, number>> = { Node: 0, Namespace: 0, Ingress: 0, Deployment: 105, DaemonSet: 260, StatefulSet: 415, Job: 570, CronJob: 725, Service: 880, ReplicaSet: 105, Pod: 105, Container: 105, ConfigMap: 1040, Secret: 1195, PersistentVolumeClaim: 1040, PersistentVolume: 1040, StorageClass: 1350 };

function synthesized(node: ResourceGraph['nodes'][number]): ClusterResource {
  return { uid: node.resourceUid, kind: node.kind, name: node.label, namespace: node.namespace, status: node.status, labels: {}, annotations: {}, conditions: [], references: [] };
}

export function buildFlowGraph(resources: ClusterResource[], graph: ResourceGraph | undefined, allowedKinds: Set<string>, search: string): { nodes: ExplorerNode[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  const resourceByUid = new Map(resources.map((resource) => [resource.uid, resource]));
  const namespaceOrder = new Map(resources.filter((resource) => resource.kind === 'Namespace').sort((a, b) => a.name.localeCompare(b.name)).map((resource, index) => [resource.name, index]));
  const rows = new Map<string, number>();
  const needle = search.toLowerCase();
  const visible = graph.nodes.filter((node) => allowedKinds.has(node.kind) && (!needle || `${node.label} ${node.kind} ${node.namespace ?? ''}`.toLowerCase().includes(needle)));
  const visibleIds = new Set(visible.map((node) => node.id));
  const nodes = visible.map((node) => {
    const resource = resourceByUid.get(node.resourceUid) ?? synthesized(node);
    const key = `${node.kind}:${node.namespace ?? 'cluster'}`;
    const row = rows.get(key) ?? 0;
    rows.set(key, row + 1);
    const namespaceOffset = (namespaceOrder.get(node.namespace ?? '') ?? 0) * 1580;
    return {
      id: node.id, type: 'resource' as const,
      position: { x: columns[node.kind] ?? 470, y: namespaceOffset + (laneOffsets[node.kind] ?? 0) + row * 98 + (node.kind === 'Node' ? 1500 : 0) },
      data: { resource }, style: { '--accent': palette[node.kind] } as CSSProperties
    };
  });
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: ['selects', 'mounts', 'routes_to', 'bound_to', 'scheduled_on'].includes(edge.relation) ? edge.relation.replaceAll('_', ' ') : undefined, type: 'smoothstep', style: { stroke: edge.relation === 'selects' ? '#38bdf8' : '#64748b' } }));
  return { nodes, edges };
}
