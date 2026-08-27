// KubernetesObserver lists first, then reconnects watches with a relist to avoid missed state changes.
import * as k8s from '@kubernetes/client-node';
import type { ClusterKind, ObservedKind, ObserverDiagnostics, ResourceAction } from '@kubeverse/shared';
import { ClusterState, type KubernetesObject } from './cluster-state.js';

type WatchDefinition = { kind: Exclude<ClusterKind, 'Container'> | 'Event'; path: string; list: () => Promise<unknown> };
type Diagnostic = ObserverDiagnostics['watchedKinds'][number];

function items(response: any): KubernetesObject[] { return (response?.body ?? response)?.items ?? []; }

// How long to wait before retrying the *initial* connection (kubeconfig load
// + client construction) after it fails - e.g. Docker Desktop's Kubernetes
// isn't up yet at backend startup, or crashed and hasn't restored its
// context. Matches the existing per-kind watch reconnect cadence
// (startWatch()'s own `setTimeout(run, 1000)`) so there's one consistent
// retry rhythm across the whole observer, not two different magic numbers.
const RECONNECT_INTERVAL_MS = 1000;

export class KubernetesObserver {
  // Constructing a KubeConfig-backed api client (k8s.KubeConfig#makeApiClient,
  // used both directly here and internally by KubernetesObjectApi.makeApiClient
  // in execution/kubernetesRunner.ts) throws synchronously - "No active
  // cluster!" - the moment the local kubeconfig has no current context/cluster
  // (e.g. Docker Desktop's Kubernetes isn't running, or crashed and hasn't
  // restored its context yet). That is a completely ordinary, expected local
  // state for KubeVerse - the whole point of the "Kubernetes unavailable"
  // banner and the environment checks in routes/environment.ts is that the
  // backend must stay up and keep retrying, never crash, when this happens.
  // These clients therefore are NOT constructed in the constructor (which
  // server.ts calls unguarded, before its own try/catch even starts) - they
  // are deferred to start()/connect(), which server.ts already wraps in a
  // try/catch for exactly this reason. The `!` assertions are safe: every
  // field is assigned before `definitions` is built below, and this class's
  // other methods (readPodLogs/readPodProxy) are only ever reached via
  // routes that already handle a rejected promise as a normal request
  // failure.
  private kubeConfig!: k8s.KubeConfig;
  private core!: k8s.CoreV1Api;
  private apps!: k8s.AppsV1Api;
  private batch!: k8s.BatchV1Api;
  private networking!: k8s.NetworkingV1Api;
  private storage!: k8s.StorageV1Api;
  private watch!: k8s.Watch;
  private readonly diagnostics = new Map<ObservedKind, Diagnostic>();
  private readonly startedAt = new Date().toISOString();
  private started = false;
  // The exact error message last recorded for a failed *connection* attempt
  // (as opposed to a per-kind list/watch failure, which already tracks its
  // own `diagnostic.lastError`) - kept so a later successful connection can
  // clear precisely that message via ClusterState.clearError's exact-string
  // match, rather than guessing at what was recorded.
  private lastConnectError?: string;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly state: ClusterState, private readonly namespaceFilter: string[]) {}

  // Called once by server.ts. Kicks off the first connection attempt and
  // returns once that attempt (success or failure) has settled - server.ts's
  // own try/catch is what that first outcome is for. If it failed, this
  // keeps retrying in the background (see connect()'s catch branch) so a
  // Kubernetes cluster that becomes reachable later - the same instance
  // reconnecting, Docker Desktop restarting, `kubectl` starting to work
  // again - is picked up automatically, without requiring the backend
  // process itself to be restarted.
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    try {
      // A fresh KubeConfig on every attempt (rather than reusing one
      // instance across retries) so a kubeconfig file that changes between
      // attempts - a new context appearing, Docker Desktop rewriting it - is
      // actually re-read, not evaluated against a stale in-memory snapshot.
      const kubeConfig = new k8s.KubeConfig();
      kubeConfig.loadFromDefault();
      const core = kubeConfig.makeApiClient(k8s.CoreV1Api);
      const apps = kubeConfig.makeApiClient(k8s.AppsV1Api);
      const batch = kubeConfig.makeApiClient(k8s.BatchV1Api);
      const networking = kubeConfig.makeApiClient(k8s.NetworkingV1Api);
      const storage = kubeConfig.makeApiClient(k8s.StorageV1Api);
      const watch = new k8s.Watch(kubeConfig);
      this.kubeConfig = kubeConfig;
      this.core = core;
      this.apps = apps;
      this.batch = batch;
      this.networking = networking;
      this.storage = storage;
      this.watch = watch;
    } catch (error) {
      const message = `Kubernetes configuration unavailable: ${this.errorText(error)}`;
      this.state.recordError(message);
      this.lastConnectError = message;
      // unref(): a pending reconnect attempt must never be the thing keeping
      // the backend process (or a test run) alive on its own - it's a
      // background retry, not application-critical work. Matches the same
      // reasoning already applied to ExperimentTracker's convergence timeout.
      this.reconnectTimer = setTimeout(() => void this.connect(), RECONNECT_INTERVAL_MS).unref();
      return;
    }
    if (this.lastConnectError) { this.state.clearError(this.lastConnectError); this.lastConnectError = undefined; }
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
