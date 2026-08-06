// This contract is the boundary between Kubernetes observation and visualization.
// It intentionally contains normalized learning data instead of raw client-library types.

export type ClusterKind = 'Namespace' | 'Deployment' | 'ReplicaSet' | 'Pod' | 'Container' | 'Service' | 'Node';

export interface OwnerReference {
  uid: string;
  kind: string;
  name: string;
}

export interface ClusterResource {
  uid: string;
  kind: ClusterKind;
  name: string;
  namespace?: string;
  status: string;
  labels: Record<string, string>;
  owner?: OwnerReference;
  creationTimestamp?: string;
  nodeName?: string;
  containers?: Array<{ name: string; status: string; image?: string; restartCount: number }>;
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
}

export interface ClusterSnapshot {
  generatedAt: string;
  resources: ClusterResource[];
  events: TimelineEvent[];
  observerErrors: string[];
}

export interface ClusterUpdate {
  action: 'ADDED' | 'MODIFIED' | 'DELETED' | 'SYNC';
  kind: ClusterKind | 'Event';
  timestamp: string;
}
