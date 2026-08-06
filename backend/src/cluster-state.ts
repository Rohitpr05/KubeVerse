// This cache is the observer's read model. It isolates the browser from raw Kubernetes API responses.
import type { ClusterKind, ClusterResource, ClusterSnapshot, ClusterUpdate, TimelineEvent } from '@simulator/shared/platform-contract';

type KubernetesObject = Record<string, any>;
type ResourceMap = Map<string, ClusterResource>;

const resourceKinds: ClusterKind[] = ['Namespace', 'Deployment', 'ReplicaSet', 'Pod', 'Service', 'Node'];

function resourceUid(resource: KubernetesObject): string {
  const metadata = resource.metadata ?? {};
  return metadata.uid ?? `${resource.kind}:${metadata.namespace ?? '_cluster'}:${metadata.name}`;
}

function isoTimestamp(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value);
}

function podStatus(resource: KubernetesObject): string {
  const phase = resource.status?.phase ?? 'Unknown';
  const ready = resource.status?.conditions?.find((condition: any) => condition.type === 'Ready')?.status;
  return ready === 'True' ? `${phase} (Ready)` : phase;
}

function workloadStatus(resource: KubernetesObject): string {
  const desired = resource.spec?.replicas ?? 1;
  const ready = resource.status?.readyReplicas ?? 0;
  return `${ready}/${desired} Ready`;
}

function statusFor(kind: ClusterKind, resource: KubernetesObject): string {
  if (kind === 'Namespace') return resource.status?.phase ?? 'Unknown';
  if (kind === 'Pod') return podStatus(resource);
  if (kind === 'Deployment' || kind === 'ReplicaSet') return workloadStatus(resource);
  if (kind === 'Service') return resource.spec?.type ?? 'ClusterIP';
  if (kind === 'Node') {
    const ready = resource.status?.conditions?.find((condition: any) => condition.type === 'Ready')?.status;
    return ready === 'True' ? 'Ready' : 'NotReady';
  }
  return 'Unknown';
}

function normalizeContainers(resource: KubernetesObject): ClusterResource['containers'] {
  const statusByName = new Map((resource.status?.containerStatuses ?? []).map((status: any) => [status.name, status]));
  return (resource.spec?.containers ?? []).map((container: any) => {
    const runtime = statusByName.get(container.name) as any;
    const state = runtime?.state?.running ? 'Running' : runtime?.state?.waiting?.reason ?? runtime?.state?.terminated?.reason ?? 'Pending';
    return { name: container.name, image: container.image, status: state, restartCount: runtime?.restartCount ?? 0 };
  });
}

export function normalizeResource(kind: ClusterKind, resource: KubernetesObject): ClusterResource {
  const metadata = resource.metadata ?? {};
  const owner = metadata.ownerReferences?.find((reference: any) => reference.controller) ?? metadata.ownerReferences?.[0];
  return {
    uid: resourceUid(resource),
    kind,
    name: metadata.name ?? 'unknown',
    namespace: metadata.namespace,
    status: statusFor(kind, resource),
    labels: metadata.labels ?? {},
    owner: owner ? { uid: owner.uid, kind: owner.kind, name: owner.name } : undefined,
    creationTimestamp: isoTimestamp(metadata.creationTimestamp),
    nodeName: resource.spec?.nodeName,
    containers: kind === 'Pod' ? normalizeContainers(resource) : undefined
  };
}

function normalizeEvent(resource: KubernetesObject): TimelineEvent {
  const metadata = resource.metadata ?? {};
  const involved = resource.involvedObject ?? resource.regarding ?? {};
  return {
    uid: resourceUid(resource),
    timestamp: isoTimestamp(resource.eventTime ?? resource.lastTimestamp ?? metadata.creationTimestamp),
    type: resource.type,
    reason: resource.reason,
    message: resource.message ?? resource.note,
    involvedUid: involved.uid,
    involvedKind: involved.kind,
    involvedName: involved.name,
    namespace: metadata.namespace
  };
}

export class ClusterState {
  private readonly resources = new Map<ClusterKind, ResourceMap>(resourceKinds.map((kind) => [kind, new Map()]));
  private readonly events = new Map<string, TimelineEvent>();
  private readonly errors = new Set<string>();

  constructor(private readonly onUpdate: (update: ClusterUpdate, snapshot: ClusterSnapshot) => void) {}

  replace(kind: ClusterKind, items: KubernetesObject[]): void {
    const map = this.resources.get(kind)!;
    map.clear();
    for (const item of items) map.set(resourceUid(item), normalizeResource(kind, item));
    this.emit({ action: 'SYNC', kind, timestamp: new Date().toISOString() });
  }

  apply(kind: ClusterKind, action: ClusterUpdate['action'], resource: KubernetesObject): void {
    const map = this.resources.get(kind)!;
    const uid = resourceUid(resource);
    if (action === 'DELETED') map.delete(uid);
    else map.set(uid, normalizeResource(kind, resource));
    this.emit({ action, kind, timestamp: new Date().toISOString() });
  }

  applyEvent(action: ClusterUpdate['action'], resource: KubernetesObject): void {
    const uid = resourceUid(resource);
    if (action === 'DELETED') this.events.delete(uid);
    else this.events.set(uid, normalizeEvent(resource));
    this.emit({ action, kind: 'Event', timestamp: new Date().toISOString() });
  }

  replaceEvents(items: KubernetesObject[]): void {
    this.events.clear();
    for (const item of items) this.events.set(resourceUid(item), normalizeEvent(item));
    this.emit({ action: 'SYNC', kind: 'Event', timestamp: new Date().toISOString() });
  }

  recordError(message: string): void {
    this.errors.add(message);
    this.emit({ action: 'SYNC', kind: 'Event', timestamp: new Date().toISOString() });
  }

  snapshot(): ClusterSnapshot {
    const resources = resourceKinds.flatMap((kind) => [...this.resources.get(kind)!.values()]);
    const events = [...this.events.values()]
      .sort((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? ''))
      .slice(0, 200);
    return { generatedAt: new Date().toISOString(), resources, events, observerErrors: [...this.errors] };
  }

  private emit(update: ClusterUpdate): void {
    this.onUpdate(update, this.snapshot());
  }
}
