// This file maps normalized, real cluster state to a visual layout. It never creates Kubernetes objects.
import type { CSSProperties } from 'react';
import type { ClusterResource, ClusterSnapshot } from '@simulator/shared/platform-contract';
import type { Edge, Node } from '@xyflow/react';

export type ExplorerNodeData = { resource: ClusterResource; containerName?: string };
export type ExplorerNode = Node<ExplorerNodeData, 'resource'>;

const palette: Record<ClusterResource['kind'], string> = {
  Namespace: '#1d4ed8',
  Deployment: '#7c3aed',
  ReplicaSet: '#a21caf',
  Pod: '#0f766e',
  Container: '#b45309',
  Service: '#0369a1',
  Node: '#475569'
};

function nodeId(resource: ClusterResource): string {
  return `${resource.kind}:${resource.uid}`;
}

function addEdge(edges: Edge[], source: string, target: string, label?: string): void {
  edges.push({ id: `${source}->${target}`, source, target, label, animated: false, style: { stroke: '#64748b' } });
}

export function buildGraph(snapshot: ClusterSnapshot): { nodes: ExplorerNode[]; edges: Edge[] } {
  const nodes: ExplorerNode[] = [];
  const edges: Edge[] = [];
  const byUid = new Map(snapshot.resources.map((resource) => [resource.uid, resource]));
  const namespaceIndex = new Map<string, number>();
  const kindRows: Record<ClusterResource['kind'], number> = { Namespace: 0, Deployment: 0, ReplicaSet: 0, Pod: 0, Container: 0, Service: 0, Node: 0 };
  const xByKind: Record<ClusterResource['kind'], number> = { Namespace: 0, Deployment: 250, ReplicaSet: 500, Pod: 750, Container: 1000, Service: 250, Node: 750 };
  const yByKind: Record<ClusterResource['kind'], number> = { Namespace: 0, Deployment: 0, ReplicaSet: 0, Pod: 0, Container: 0, Service: 500, Node: 700 };
  const visibleKinds: ClusterResource['kind'][] = ['Namespace', 'Deployment', 'ReplicaSet', 'Pod', 'Service', 'Node'];

  for (const resource of snapshot.resources.filter((item) => item.kind === 'Namespace').sort((a, b) => a.name.localeCompare(b.name))) {
    namespaceIndex.set(resource.name, namespaceIndex.size);
    nodes.push({ id: nodeId(resource), type: 'resource', position: { x: 0, y: namespaceIndex.size * 260 }, data: { resource }, style: { '--accent': palette.Namespace } as CSSProperties });
  }

  for (const kind of visibleKinds.filter((item) => item !== 'Namespace')) {
    for (const resource of snapshot.resources.filter((item) => item.kind === kind).sort((a, b) => a.name.localeCompare(b.name))) {
      const namespaceOffset = resource.namespace ? (namespaceIndex.get(resource.namespace) ?? namespaceIndex.size) * 260 : 0;
      const index = kindRows[kind]++;
      nodes.push({
        id: nodeId(resource),
        type: 'resource',
        position: { x: xByKind[kind], y: yByKind[kind] + namespaceOffset + (index % 5) * 95 },
        data: { resource },
        style: { '--accent': palette[kind] } as CSSProperties
      });

      if (resource.owner && byUid.has(resource.owner.uid)) addEdge(edges, nodeId(byUid.get(resource.owner.uid)!), nodeId(resource));
      else if (resource.namespace && namespaceIndex.has(resource.namespace)) {
        const namespace = snapshot.resources.find((item) => item.kind === 'Namespace' && item.name === resource.namespace);
        if (namespace) addEdge(edges, nodeId(namespace), nodeId(resource));
      }
      if (kind === 'Pod' && resource.nodeName) {
        const node = snapshot.resources.find((item) => item.kind === 'Node' && item.name === resource.nodeName);
        if (node) addEdge(edges, nodeId(node), nodeId(resource), 'scheduled');
      }
    }
  }

  for (const pod of snapshot.resources.filter((item) => item.kind === 'Pod')) {
    const podNode = nodeId(pod);
    for (const [index, container] of (pod.containers ?? []).entries()) {
      const containerResource: ClusterResource = {
        uid: `${pod.uid}:${container.name}`,
        kind: 'Container',
        name: container.name,
        namespace: pod.namespace,
        status: `${container.status} · ${container.restartCount} restarts`,
        labels: {},
        owner: { uid: pod.uid, kind: 'Pod', name: pod.name },
        creationTimestamp: pod.creationTimestamp
      };
      const podGraphNode = nodes.find((node) => node.id === podNode);
      nodes.push({
        id: nodeId(containerResource),
        type: 'resource',
        position: { x: (podGraphNode?.position.x ?? 750) + 260, y: (podGraphNode?.position.y ?? 0) + index * 95 },
        data: { resource: containerResource, containerName: container.name },
        style: { '--accent': palette.Container } as CSSProperties
      });
      addEdge(edges, podNode, nodeId(containerResource));
    }
  }
  return { nodes, edges };
}
