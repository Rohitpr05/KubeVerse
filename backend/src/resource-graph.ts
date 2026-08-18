// The graph builder resolves ownership, selectors, scheduling, and storage references into reusable topology edges.
import type { ClusterResource, GraphEdge, GraphNode, ResourceGraph } from '@simulator/shared/platform-contract';

function matchesSelector(labels: Record<string, string>, selector: Record<string, string> | undefined): boolean {
  return Boolean(selector && Object.entries(selector).every(([key, value]) => labels[key] === value));
}

export class ResourceGraphBuilder {
  build(resources: ClusterResource[]): ResourceGraph {
    const edges: GraphEdge[] = [];
    const byUid = new Map(resources.map((resource) => [resource.uid, resource]));
    const byKey = new Map(resources.map((resource) => [`${resource.kind}:${resource.namespace ?? '_cluster'}:${resource.name}`, resource]));
    const add = (source: string, target: string, relation: string) => edges.push({ id: `${relation}:${source}:${target}`, source, target, relation });
    for (const resource of resources) {
      if (resource.owner && byUid.has(resource.owner.uid)) add(resource.owner.uid, resource.uid, 'owns');
      else if (resource.namespace) {
        const namespace = byKey.get(`Namespace:_cluster:${resource.namespace}`);
        if (namespace) add(namespace.uid, resource.uid, 'contains');
      }
      if (resource.kind === 'Pod' && resource.nodeName) {
        const node = byKey.get(`Node:_cluster:${resource.nodeName}`);
        if (node) add(node.uid, resource.uid, 'scheduled_on');
      }
      for (const reference of resource.references) {
        const target = reference.uid ? byUid.get(reference.uid) : byKey.get(`${reference.kind}:${reference.namespace ?? '_cluster'}:${reference.name}`);
        if (target) add(resource.uid, target.uid, reference.relation);
      }
      if (resource.kind === 'Service') for (const pod of resources.filter((item) => item.kind === 'Pod' && item.namespace === resource.namespace && matchesSelector(item.labels, resource.selector))) add(resource.uid, pod.uid, 'selects');
      if (resource.kind === 'Pod') for (const container of resource.containers ?? []) add(resource.uid, `${resource.uid}:${container.name}`, 'runs');
    }
    const nodes: GraphNode[] = resources.flatMap((resource) => [
      { id: resource.uid, resourceUid: resource.uid, kind: resource.kind, label: resource.name, status: resource.status, namespace: resource.namespace },
      ...(resource.containers ?? []).map((container) => ({ id: `${resource.uid}:${container.name}`, resourceUid: `${resource.uid}:${container.name}`, kind: 'Container' as const, label: container.name, status: container.status, namespace: resource.namespace }))
    ]);
    return { generatedAt: new Date().toISOString(), nodes, edges };
  }
}
