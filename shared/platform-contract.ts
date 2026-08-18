// Stable contracts shared by the real-cluster platform backend and the React explorer.
export const clusterKinds = [
  'Namespace', 'Node', 'Deployment', 'ReplicaSet', 'Pod', 'Container', 'Service', 'Ingress',
  'DaemonSet', 'StatefulSet', 'Job', 'CronJob', 'ConfigMap', 'Secret',
  'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass'
] as const;

export type ClusterKind = typeof clusterKinds[number];
export type ObservedKind = Exclude<ClusterKind, 'Container'> | 'Event';
export type ResourceAction = 'ADDED' | 'MODIFIED' | 'DELETED' | 'SYNC';

export interface OwnerReference { uid: string; kind: string; name: string; }
export interface ResourceCondition { type: string; status: string; reason?: string; message?: string; }
export interface ContainerSummary { name: string; status: string; image?: string; restartCount: number; }
export interface ResourceReference { uid?: string; kind: ClusterKind | string; name: string; namespace?: string; relation: string; }

export interface ClusterResource {
  uid: string;
  kind: ClusterKind;
  name: string;
  namespace?: string;
  status: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  owner?: OwnerReference;
  creationTimestamp?: string;
  nodeName?: string;
  conditions: ResourceCondition[];
  containers?: ContainerSummary[];
  selector?: Record<string, string>;
  references: ResourceReference[];
}

export interface TimelineEvent {
  uid: string;
  timestamp?: string;
  type?: string;
  reason?: string;
  message?: string;
  involvedUid?: string;
  involvedKind?: string;
  involvedName?: string;
  namespace?: string;
  source: 'kubernetes_event' | 'resource_change';
  action?: ResourceAction;
}

export interface ResourceHistoryEntry {
  uid: string;
  kind: ClusterKind;
  action: ResourceAction;
  timestamp: string;
  status?: string;
}

export interface ClusterStatistics {
  generatedAt: string;
  resourceCounts: Partial<Record<ClusterKind, number>>;
  readyPods: number;
  totalPods: number;
  readyNodes: number;
  totalNodes: number;
}

export interface ClusterSnapshot {
  generatedAt: string;
  resources: ClusterResource[];
  events: TimelineEvent[];
  statistics: ClusterStatistics;
  observerErrors: string[];
}

export interface ClusterUpdate {
  action: ResourceAction;
  kind: ClusterKind | 'Event';
  timestamp: string;
  resource?: ClusterResource;
  removedUid?: string;
  event?: TimelineEvent;
}

export interface GraphNode { id: string; resourceUid: string; kind: ClusterKind; label: string; status: string; namespace?: string; }
export interface GraphEdge { id: string; source: string; target: string; relation: string; }
export interface ResourceGraph { generatedAt: string; nodes: GraphNode[]; edges: GraphEdge[]; }

export interface ResourceDetail { resource: ClusterResource; rawYaml: string; history: ResourceHistoryEntry[]; events: TimelineEvent[]; }

export interface MetricsSnapshot {
  source: 'unavailable' | 'metrics.k8s.io';
  available: boolean;
  collectedAt: string;
  podMetrics: Array<{ podUid?: string; namespace: string; name: string; cpu?: string; memory?: string }>;
  message?: string;
}

export interface ObserverDiagnostics {
  startedAt: string;
  watchedKinds: Array<{ kind: ObservedKind; connected: boolean; lastListAt?: string; lastEventAt?: string; reconnects: number; lastError?: string }>;
  namespaceFilter: string[];
}
