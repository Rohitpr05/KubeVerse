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

export interface ReplicaCounts { desired: number; current: number; ready: number; }
export interface ServicePort { name?: string; port: number; targetPort: number; }

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
  // Structured replica counts for workload kinds (Deployment/ReplicaSet/
  // StatefulSet/DaemonSet) - the same numbers `status` already renders as a
  // human string (e.g. "1/2 Ready"), exposed machine-readably so the Lab
  // experiment tracker can detect real scale convergence (desired === current
  // === ready) without re-parsing that string.
  replicas?: ReplicaCounts;
  // Real container/target ports for a Service, read directly from
  // spec.ports - used by the Lab traffic generator to know which port to
  // reach on the Service's backing Pods; never guessed or defaulted from
  // application conventions.
  servicePorts?: ServicePort[];
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

// --- Lab experiments (Phase 2) -------------------------------------------
// A "Lab experiment" is a real, project-scoped Kubernetes mutation
// (delete Pod / scale Deployment / rolling-restart Deployment / generate
// real HTTP traffic) plus a running log of the *observed* Kubernetes state
// transitions that followed it. Kubernetes remains the sole source of truth
// for those transitions - this is bookkeeping around real observer events
// (backend/src/cluster-state.ts), never a second simulated state model. If a
// transition is never observed, `transitions` simply never gets an entry for
// it - nothing here is ever fabricated to fill a gap.
export type LabExperimentKind = 'traffic' | 'pod-failure' | 'restart' | 'scale';
export type LabExperimentStatus = 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface LabTransition {
  timestamp: string;
  kind: ClusterKind;
  name: string;
  status: string;
  note: string;
  explanation?: string;
}

export interface TrafficStats {
  sent: number;
  succeeded: number;
  failed: number;
  currentRps: number;
  avgLatencyMs: number;
  errorRate: number;
  targetPods: string[];
  lastHitPod?: string;
}

export interface LabExperiment {
  id: string;
  projectId: string;
  kind: LabExperimentKind;
  target: { kind: ClusterKind; namespace: string; name: string };
  action: string;
  startedAt: string;
  endedAt?: string;
  status: LabExperimentStatus;
  transitions: LabTransition[];
  traffic?: TrafficStats;
  error?: string;
}

export interface LabUpdate {
  experiment: LabExperiment;
}
