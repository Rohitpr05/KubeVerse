// ResourceCache is the platform's durable-in-process read model for all observer APIs.
import type {
  ClusterKind, ClusterResource, ClusterSnapshot, ClusterStatistics, ClusterUpdate, ObservedKind,
  ResourceAction, ResourceDetail, ResourceHistoryEntry, TimelineEvent
} from '@kubeverse/shared';
import { clusterKinds } from '@kubeverse/shared';
import { stringify } from 'yaml';
import { isOwnedByProject } from './ownership.js';
import { ResourceGraphBuilder } from './resource-graph.js';

export type KubernetesObject = Record<string, any>;
type StoredResource = { resource: ClusterResource; raw: KubernetesObject };

const storedKinds = clusterKinds.filter((kind) => kind !== 'Container');

function uidFor(raw: KubernetesObject): string {
  const metadata = raw.metadata ?? {};
  return metadata.uid ?? `${raw.kind}:${metadata.namespace ?? '_cluster'}:${metadata.name}`;
}

function toTimestamp(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value);
}

function conditions(raw: KubernetesObject): ClusterResource['conditions'] {
  return (raw.status?.conditions ?? []).map((condition: any) => ({ type: condition.type, status: condition.status, reason: condition.reason, message: condition.message }));
}

function workloadStatus(raw: KubernetesObject): string {
  const desired = raw.spec?.replicas ?? 1;
  return `${raw.status?.readyReplicas ?? 0}/${desired} Ready`;
}

function podStatus(raw: KubernetesObject): string {
  const phase = raw.status?.phase ?? 'Unknown';
  const ready = raw.status?.conditions?.find((condition: any) => condition.type === 'Ready')?.status;
  return ready === 'True' ? `${phase} (Ready)` : phase;
}

function resourceStatus(kind: ClusterKind, raw: KubernetesObject): string {
  switch (kind) {
    case 'Namespace': return raw.status?.phase ?? 'Unknown';
    case 'Node': return raw.status?.conditions?.find((condition: any) => condition.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady';
    case 'Pod': return podStatus(raw);
    case 'Deployment': case 'ReplicaSet': case 'StatefulSet': return workloadStatus(raw);
    case 'DaemonSet': return `${raw.status?.numberReady ?? 0}/${raw.status?.desiredNumberScheduled ?? 0} Ready`;
    case 'Job': return raw.status?.succeeded ? 'Complete' : raw.status?.failed ? 'Failed' : 'Running';
    case 'CronJob': return raw.spec?.suspend ? 'Suspended' : 'Scheduled';
    case 'Service': return raw.spec?.type ?? 'ClusterIP';
    case 'Ingress': return raw.status?.loadBalancer?.ingress?.length ? 'Address assigned' : 'Pending address';
    case 'PersistentVolumeClaim': return raw.status?.phase ?? 'Pending';
    case 'PersistentVolume': return raw.status?.phase ?? 'Available';
    case 'StorageClass': return raw.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ? 'Default' : 'Available';
    case 'ConfigMap': return 'Available';
    case 'Secret': return raw.type ?? 'Opaque';
    default: return 'Unknown';
  }
}

function containers(raw: KubernetesObject): ClusterResource['containers'] {
  const statuses = new Map((raw.status?.containerStatuses ?? []).map((status: any) => [status.name, status]));
  return (raw.spec?.containers ?? []).map((container: any) => {
    const runtime = statuses.get(container.name) as any;
    const status = runtime?.state?.running ? 'Running' : runtime?.state?.waiting?.reason ?? runtime?.state?.terminated?.reason ?? 'Pending';
    return { name: container.name, image: container.image, status, restartCount: runtime?.restartCount ?? 0 };
  });
}

function podReferences(raw: KubernetesObject): ClusterResource['references'] {
  const namespace = raw.metadata?.namespace;
  return (raw.spec?.volumes ?? []).flatMap((volume: any) => {
    if (volume.configMap?.name) return [{ kind: 'ConfigMap', name: volume.configMap.name, namespace, relation: 'mounts' }];
    if (volume.secret?.secretName) return [{ kind: 'Secret', name: volume.secret.secretName, namespace, relation: 'mounts' }];
    if (volume.persistentVolumeClaim?.claimName) return [{ kind: 'PersistentVolumeClaim', name: volume.persistentVolumeClaim.claimName, namespace, relation: 'mounts' }];
    return [];
  });
}

function ingressReferences(raw: KubernetesObject): ClusterResource['references'] {
  const namespace = raw.metadata?.namespace;
  return (raw.spec?.rules ?? []).flatMap((rule: any) => rule.http?.paths ?? []).flatMap((path: any) => {
    const service = path.backend?.service;
    return service?.name ? [{ kind: 'Service', name: service.name, namespace, relation: 'routes_to' }] : [];
  });
}

function resourceReferences(kind: ClusterKind, raw: KubernetesObject): ClusterResource['references'] {
  if (kind === 'Pod') return podReferences(raw);
  if (kind === 'Ingress') return ingressReferences(raw);
  if (kind === 'PersistentVolume' && raw.spec?.claimRef?.name) return [{ kind: 'PersistentVolumeClaim', name: raw.spec.claimRef.name, namespace: raw.spec.claimRef.namespace, relation: 'bound_to' }];
  if (kind === 'PersistentVolumeClaim' && raw.spec?.volumeName) return [{ kind: 'PersistentVolume', name: raw.spec.volumeName, relation: 'bound_to' }];
  if (kind === 'PersistentVolumeClaim' && raw.spec?.storageClassName) return [{ kind: 'StorageClass', name: raw.spec.storageClassName, relation: 'uses' }];
  return [];
}

export function normalizeResource(kind: ClusterKind, raw: KubernetesObject): ClusterResource {
  const metadata = raw.metadata ?? {};
  const owner = metadata.ownerReferences?.find((reference: any) => reference.controller) ?? metadata.ownerReferences?.[0];
  return {
    uid: uidFor(raw), kind, name: metadata.name ?? 'unknown', namespace: metadata.namespace,
    status: resourceStatus(kind, raw), labels: metadata.labels ?? {}, annotations: metadata.annotations ?? {},
    owner: owner ? { uid: owner.uid, kind: owner.kind, name: owner.name } : undefined,
    creationTimestamp: toTimestamp(metadata.creationTimestamp), nodeName: raw.spec?.nodeName,
    conditions: conditions(raw), containers: kind === 'Pod' ? containers(raw) : undefined,
    selector: raw.spec?.selector?.matchLabels ?? raw.spec?.selector,
    references: resourceReferences(kind, raw)
  };
}

function normalizeEvent(raw: KubernetesObject): TimelineEvent {
  const metadata = raw.metadata ?? {};
  const involved = raw.involvedObject ?? raw.regarding ?? {};
  return {
    uid: uidFor(raw), timestamp: toTimestamp(raw.eventTime ?? raw.lastTimestamp ?? metadata.creationTimestamp), type: raw.type,
    reason: raw.reason, message: raw.message ?? raw.note, involvedUid: involved.uid, involvedKind: involved.kind,
    involvedName: involved.name, namespace: metadata.namespace, source: 'kubernetes_event'
  };
}

export class ClusterState {
  private readonly records = new Map<string, StoredResource>();
  private readonly resourceKeys = new Map<string, string>();
  private readonly events = new Map<string, TimelineEvent>();
  private readonly history = new Map<string, ResourceHistoryEntry[]>();
  private readonly errors = new Set<string>();
  private readonly graphBuilder = new ResourceGraphBuilder();

  constructor(
    // `resource`/`event` (when present) is the object the update is *about* -
    // for a DELETED update it's the resource/event as it was immediately
    // before removal, captured here because by the time a caller could look
    // it up from current state it would already be gone. This lets a
    // project-scoped broadcast layer (server.ts) decide per-update whether a
    // given change is relevant to a given connected client's project,
    // without ClusterState itself needing to know what a "KubeVerse project"
    // is - it stays a generic Kubernetes read model either way.
    private readonly onUpdate: (update: ClusterUpdate, resource?: ClusterResource, event?: TimelineEvent) => void,
    private readonly namespaces: Set<string> = new Set()
  ) {}

  replace(kind: Exclude<ClusterKind, 'Container'>, objects: KubernetesObject[]): void {
    const visible = objects.filter((object) => this.visible(kind, object));
    for (const [uid, record] of this.records) if (record.resource.kind === kind) this.delete(uid, false);
    for (const object of visible) this.upsert(kind, 'SYNC', object, false);
    this.onUpdate({ action: 'SYNC', kind, timestamp: new Date().toISOString() });
  }

  apply(kind: Exclude<ClusterKind, 'Container'>, action: ResourceAction, raw: KubernetesObject): void {
    if (!this.visible(kind, raw)) return;
    if (action === 'DELETED') {
      const uid = uidFor(raw);
      this.delete(uid, true, kind);
      return;
    }
    this.upsert(kind, action, raw, true);
  }

  replaceEvents(objects: KubernetesObject[]): void {
    this.events.clear();
    for (const object of objects.filter((item) => this.visible('Event', item))) this.events.set(uidFor(object), normalizeEvent(object));
    this.onUpdate({ action: 'SYNC', kind: 'Event', timestamp: new Date().toISOString() });
  }

  applyEvent(action: ResourceAction, raw: KubernetesObject): void {
    if (!this.visible('Event', raw)) return;
    const uid = uidFor(raw);
    const previous = this.events.get(uid);
    if (action === 'DELETED') this.events.delete(uid);
    else this.events.set(uid, normalizeEvent(raw));
    const event = action === 'DELETED' ? previous : this.events.get(uid);
    this.onUpdate({ action, kind: 'Event', timestamp: new Date().toISOString(), event }, undefined, event);
  }

  recordError(message: string): void { this.errors.add(message); }
  clearError(message: string): void { this.errors.delete(message); }

  snapshot(): ClusterSnapshot {
    const resources = [...this.records.values()].map((record) => record.resource);
    return {
      generatedAt: new Date().toISOString(), resources,
      events: [...this.events.values()].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')).slice(0, 500),
      statistics: this.statistics(resources), observerErrors: [...this.errors]
    };
  }

  resources(filters: { kind?: string; namespace?: string; search?: string }): ClusterResource[] {
    const needle = filters.search?.toLowerCase();
    return [...this.records.values()].map((record) => record.resource).filter((resource) =>
      (!filters.kind || resource.kind === filters.kind) && (!filters.namespace || resource.namespace === filters.namespace) &&
      (!needle || `${resource.name} ${resource.kind} ${resource.namespace ?? ''}`.toLowerCase().includes(needle))
    );
  }

  detail(kind: string, namespace: string | undefined, name: string): ResourceDetail | undefined {
    const uid = this.resourceKeys.get(this.key(kind, namespace, name));
    const record = uid ? this.records.get(uid) : undefined;
    if (!record) return undefined;
    return { resource: record.resource, rawYaml: stringify(record.raw), history: this.history.get(record.resource.uid) ?? [], events: this.relatedEvents(record.resource) };
  }

  graph(namespace?: string) { return this.graphBuilder.build(this.resources({ namespace })); }
  timeline(limit = 200, namespace?: string): TimelineEvent[] {
    const eventItems = [...this.events.values()].filter((event) => !namespace || event.namespace === namespace);
    const historyItems: TimelineEvent[] = [...this.history.values()].flat().map((item) => ({ uid: `${item.uid}:${item.timestamp}`, timestamp: item.timestamp, source: 'resource_change', action: item.action, involvedUid: item.uid, involvedKind: item.kind, message: `${item.action} ${item.kind}`, namespace: this.records.get(item.uid)?.resource.namespace }));
    return [...eventItems, ...historyItems].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')).slice(0, limit);
  }

  // --- Project-scoped view (KUBEVERSE_MASTER_SPEC.md, "Component
  // responsibilities" - the Playground answers "how is MY architecture
  // running", never "what is running on this cluster"). Ownership is decided
  // exclusively by the kubeverse.dev/project-id label (backend/src/ownership.ts)
  // that KubeVerse's generators stamp onto every resource they produce - a
  // resource with no such label, or a different project's id, is simply not
  // included; nothing here infers ownership from names, namespaces, or images.

  // A resource belongs to a project if it carries that project's ownership
  // label directly, *or* - the one deliberate exception - it's a cluster-scoped
  // Node that is currently hosting at least one of that project's Pods. Nodes
  // can't be labelled per-project (they're shared cluster infrastructure), so
  // "relevant to this project" is the closest honest equivalent to ownership.
  isResourceOwnedByProject(resource: ClusterResource | undefined, projectId: string): boolean {
    if (!resource) return false;
    if (isOwnedByProject(resource.labels, projectId)) return true;
    if (resource.kind === 'Node') {
      for (const record of this.records.values()) {
        if (record.resource.kind === 'Pod' && record.resource.nodeName === resource.name && isOwnedByProject(record.resource.labels, projectId)) return true;
      }
    }
    return false;
  }

  // Events are never labelled themselves - relevance is decided by resolving
  // the event's involved object (by uid, falling back to kind/namespace/name)
  // against current state and checking *that* object's ownership.
  isEventRelevantToProject(event: TimelineEvent | undefined, projectId: string): boolean {
    if (!event) return false;
    const byUid = event.involvedUid ? this.records.get(event.involvedUid) : undefined;
    if (byUid) return this.isResourceOwnedByProject(byUid.resource, projectId);
    if (event.involvedKind && event.involvedName) {
      const uid = this.resourceKeys.get(this.key(event.involvedKind, event.namespace, event.involvedName));
      const record = uid ? this.records.get(uid) : undefined;
      if (record) return this.isResourceOwnedByProject(record.resource, projectId);
    }
    return false;
  }

  projectResources(projectId: string): ClusterResource[] {
    return [...this.records.values()].map((record) => record.resource).filter((resource) => this.isResourceOwnedByProject(resource, projectId));
  }

  projectSnapshot(projectId: string): ClusterSnapshot {
    const resources = this.projectResources(projectId);
    const events = [...this.events.values()]
      .filter((event) => this.isEventRelevantToProject(event, projectId))
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, 500);
    return { generatedAt: new Date().toISOString(), resources, events, statistics: this.statistics(resources), observerErrors: [...this.errors] };
  }

  projectGraph(projectId: string) { return this.graphBuilder.build(this.projectResources(projectId)); }

  projectTimeline(limit = 200, projectId: string): TimelineEvent[] {
    const eventItems = [...this.events.values()].filter((event) => this.isEventRelevantToProject(event, projectId));
    const historyItems: TimelineEvent[] = [...this.history.values()]
      .flat()
      .filter((item) => this.isResourceOwnedByProject(this.records.get(item.uid)?.resource, projectId))
      .map((item) => ({ uid: `${item.uid}:${item.timestamp}`, timestamp: item.timestamp, source: 'resource_change', action: item.action, involvedUid: item.uid, involvedKind: item.kind, message: `${item.action} ${item.kind}`, namespace: this.records.get(item.uid)?.resource.namespace }));
    return [...eventItems, ...historyItems].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')).slice(0, limit);
  }

  private upsert(kind: Exclude<ClusterKind, 'Container'>, action: ResourceAction, raw: KubernetesObject, emit: boolean): void {
    const resource = normalizeResource(kind, raw);
    this.records.set(resource.uid, { resource, raw });
    this.resourceKeys.set(this.key(resource.kind, resource.namespace, resource.name), resource.uid);
    this.addHistory(resource, action);
    if (emit) this.onUpdate({ action, kind, timestamp: new Date().toISOString(), resource }, resource);
  }

  private delete(uid: string, emit: boolean, kind?: Exclude<ClusterKind, 'Container'>): void {
    const record = this.records.get(uid);
    if (!record) return;
    this.records.delete(uid);
    this.resourceKeys.delete(this.key(record.resource.kind, record.resource.namespace, record.resource.name));
    this.addHistory(record.resource, 'DELETED');
    if (emit) this.onUpdate({ action: 'DELETED', kind: kind ?? record.resource.kind, timestamp: new Date().toISOString(), removedUid: uid }, record.resource);
  }

  private addHistory(resource: ClusterResource, action: ResourceAction): void {
    const entries = this.history.get(resource.uid) ?? [];
    entries.unshift({ uid: resource.uid, kind: resource.kind, action, timestamp: new Date().toISOString(), status: resource.status });
    this.history.set(resource.uid, entries.slice(0, 100));
  }

  private relatedEvents(resource: ClusterResource): TimelineEvent[] {
    return [...this.events.values()].filter((event) => event.involvedUid === resource.uid || (event.involvedKind === resource.kind && event.involvedName === resource.name && event.namespace === resource.namespace));
  }

  private statistics(resources: ClusterResource[]): ClusterStatistics {
    const resourceCounts = Object.fromEntries(clusterKinds.map((kind) => [kind, resources.filter((resource) => resource.kind === kind).length]));
    const pods = resources.filter((resource) => resource.kind === 'Pod');
    const nodes = resources.filter((resource) => resource.kind === 'Node');
    return { generatedAt: new Date().toISOString(), resourceCounts, totalPods: pods.length, readyPods: pods.filter((pod) => pod.status.includes('(Ready)')).length, totalNodes: nodes.length, readyNodes: nodes.filter((node) => node.status === 'Ready').length };
  }

  private visible(kind: ObservedKind, raw: KubernetesObject): boolean {
    if (this.namespaces.size === 0) return true;
    if (kind === 'Namespace') return this.namespaces.has(raw.metadata?.name);
    if (['Node', 'PersistentVolume', 'StorageClass'].includes(kind)) return true;
    return this.namespaces.has(raw.metadata?.namespace);
  }
  private key(kind: string, namespace: string | undefined, name: string): string { return `${kind}:${namespace ?? '_cluster'}:${name}`; }
}
