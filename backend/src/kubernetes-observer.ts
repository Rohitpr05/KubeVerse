// KubernetesObserver lists first, then reconnects watches with a relist to avoid missed state changes.
import * as k8s from '@kubernetes/client-node';
import type { ClusterKind, ObservedKind, ObserverDiagnostics, ResourceAction } from '@simulator/shared/platform-contract';
import { ClusterState, type KubernetesObject } from './cluster-state.js';

type WatchDefinition = { kind: Exclude<ClusterKind, 'Container'> | 'Event'; path: string; list: () => Promise<unknown> };
type Diagnostic = ObserverDiagnostics['watchedKinds'][number];

function items(response: any): KubernetesObject[] { return (response?.body ?? response)?.items ?? []; }

export class KubernetesObserver {
  private readonly kubeConfig = new k8s.KubeConfig();
  private readonly core: k8s.CoreV1Api;
  private readonly apps: k8s.AppsV1Api;
  private readonly batch: k8s.BatchV1Api;
  private readonly networking: k8s.NetworkingV1Api;
  private readonly storage: k8s.StorageV1Api;
  private readonly watch: k8s.Watch;
  private readonly diagnostics = new Map<ObservedKind, Diagnostic>();
  private readonly startedAt = new Date().toISOString();
  private started = false;

  constructor(private readonly state: ClusterState, private readonly namespaceFilter: string[]) {
    this.kubeConfig.loadFromDefault();
    this.core = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.apps = this.kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.batch = this.kubeConfig.makeApiClient(k8s.BatchV1Api);
    this.networking = this.kubeConfig.makeApiClient(k8s.NetworkingV1Api);
    this.storage = this.kubeConfig.makeApiClient(k8s.StorageV1Api);
    this.watch = new k8s.Watch(this.kubeConfig);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const definitions: WatchDefinition[] = [
      { kind: 'Namespace', path: '/api/v1/namespaces', list: () => this.core.listNamespace() },
      { kind: 'Node', path: '/api/v1/nodes', list: () => this.core.listNode() },
      { kind: 'Deployment', path: '/apis/apps/v1/deployments', list: () => this.apps.listDeploymentForAllNamespaces() },
      { kind: 'ReplicaSet', path: '/apis/apps/v1/replicasets', list: () => this.apps.listReplicaSetForAllNamespaces() },
      { kind: 'DaemonSet', path: '/apis/apps/v1/daemonsets', list: () => this.apps.listDaemonSetForAllNamespaces() },
      { kind: 'StatefulSet', path: '/apis/apps/v1/statefulsets', list: () => this.apps.listStatefulSetForAllNamespaces() },
      { kind: 'Pod', path: '/api/v1/pods', list: () => this.core.listPodForAllNamespaces() },
      { kind: 'Service', path: '/api/v1/services', list: () => this.core.listServiceForAllNamespaces() },
      { kind: 'Ingress', path: '/apis/networking.k8s.io/v1/ingresses', list: () => this.networking.listIngressForAllNamespaces() },
      { kind: 'Job', path: '/apis/batch/v1/jobs', list: () => this.batch.listJobForAllNamespaces() },
      { kind: 'CronJob', path: '/apis/batch/v1/cronjobs', list: () => this.batch.listCronJobForAllNamespaces() },
      { kind: 'ConfigMap', path: '/api/v1/configmaps', list: () => this.core.listConfigMapForAllNamespaces() },
      { kind: 'Secret', path: '/api/v1/secrets', list: () => this.core.listSecretForAllNamespaces() },
      { kind: 'PersistentVolume', path: '/api/v1/persistentvolumes', list: () => this.core.listPersistentVolume() },
      { kind: 'PersistentVolumeClaim', path: '/api/v1/persistentvolumeclaims', list: () => this.core.listPersistentVolumeClaimForAllNamespaces() },
      { kind: 'StorageClass', path: '/apis/storage.k8s.io/v1/storageclasses', list: () => this.storage.listStorageClass() },
      { kind: 'Event', path: '/api/v1/events', list: () => this.core.listEventForAllNamespaces() }
    ];
    await Promise.all(definitions.map((definition) => this.resync(definition).then(() => this.startWatch(definition))));
  }

  diagnosticsSnapshot(): ObserverDiagnostics {
    return { startedAt: this.startedAt, namespaceFilter: this.namespaceFilter, watchedKinds: [...this.diagnostics.values()] };
  }

  async readPodLogs(namespace: string, name: string, container?: string, tailLines = 200): Promise<string> {
    return this.core.readNamespacedPodLog({ name, namespace, container, follow: false, tailLines, timestamps: true });
  }

  async readPodProxy(namespace: string, name: string, path: string): Promise<string> {
    return this.core.connectGetNamespacedPodProxy({ name, namespace, path });
  }

  private async resync(definition: WatchDefinition): Promise<void> {
    const diagnostic = this.getDiagnostic(definition.kind);
    try {
      const listed = items(await definition.list());
      if (definition.kind === 'Event') this.state.replaceEvents(listed);
      else this.state.replace(definition.kind, listed);
      diagnostic.lastListAt = new Date().toISOString();
      diagnostic.lastError = undefined;
    } catch (error) {
      diagnostic.lastError = this.errorText(error);
      this.state.recordError(`${definition.kind} list failed: ${diagnostic.lastError}`);
    }
  }

  private startWatch(definition: WatchDefinition): void {
    const run = async (): Promise<void> => {
      const diagnostic = this.getDiagnostic(definition.kind);
      try {
        diagnostic.connected = true;
        await this.watch.watch(definition.path, {}, (phase: string, raw: KubernetesObject) => {
          if (!raw || phase === 'BOOKMARK' || phase === 'ERROR') return;
          diagnostic.lastEventAt = new Date().toISOString();
          const action = phase as ResourceAction;
          if (definition.kind === 'Event') this.state.applyEvent(action, raw);
          else this.state.apply(definition.kind, action, raw);
        }, async (error: unknown) => {
          diagnostic.connected = false;
          if (error) diagnostic.lastError = this.errorText(error);
          diagnostic.reconnects += 1;
          await this.resync(definition);
          setTimeout(run, 1000);
        });
      } catch (error) {
        diagnostic.connected = false;
        diagnostic.lastError = this.errorText(error);
        diagnostic.reconnects += 1;
        await this.resync(definition);
        setTimeout(run, 1000);
      }
    };
    void run();
  }

  private getDiagnostic(kind: ObservedKind): Diagnostic {
    const existing = this.diagnostics.get(kind);
    if (existing) return existing;
    const created: Diagnostic = { kind, connected: false, reconnects: 0 };
    this.diagnostics.set(kind, created);
    return created;
  }
  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
