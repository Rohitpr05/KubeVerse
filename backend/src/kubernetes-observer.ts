// The observer owns Kubernetes list/watch lifecycles and feeds only normalized changes into ClusterState.
import * as k8s from '@kubernetes/client-node';
import type { ClusterKind } from '@simulator/shared/platform-contract';
import { ClusterState } from './cluster-state.js';

type WatchDefinition = {
  kind: ClusterKind | 'Event';
  path: string;
  list: () => Promise<unknown>;
};

function listItems(response: any): any[] {
  const body = response?.body ?? response;
  return body?.items ?? [];
}

export class KubernetesObserver {
  private readonly kubeConfig = new k8s.KubeConfig();
  private readonly core: k8s.CoreV1Api;
  private readonly apps: k8s.AppsV1Api;
  private readonly watch: k8s.Watch;
  private started = false;

  constructor(private readonly state: ClusterState) {
    this.kubeConfig.loadFromDefault();
    this.core = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.apps = this.kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.watch = new k8s.Watch(this.kubeConfig);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const definitions: WatchDefinition[] = [
      { kind: 'Namespace', path: '/api/v1/namespaces', list: () => this.core.listNamespace() },
      { kind: 'Deployment', path: '/apis/apps/v1/deployments', list: () => this.apps.listDeploymentForAllNamespaces() },
      { kind: 'ReplicaSet', path: '/apis/apps/v1/replicasets', list: () => this.apps.listReplicaSetForAllNamespaces() },
      { kind: 'Pod', path: '/api/v1/pods', list: () => this.core.listPodForAllNamespaces() },
      { kind: 'Service', path: '/api/v1/services', list: () => this.core.listServiceForAllNamespaces() },
      { kind: 'Node', path: '/api/v1/nodes', list: () => this.core.listNode() },
      { kind: 'Event', path: '/api/v1/events', list: () => this.core.listEventForAllNamespaces() }
    ];

    await Promise.all(definitions.map(async (definition) => {
      try {
        const items = listItems(await definition.list());
        if (definition.kind === 'Event') this.state.replaceEvents(items);
        else this.state.replace(definition.kind, items);
        this.startWatch(definition);
      } catch (error) {
        this.state.recordError(`Initial ${definition.kind} list failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  private startWatch(definition: WatchDefinition): void {
    const run = async (): Promise<void> => {
      try {
        await this.watch.watch(
          definition.path,
          {},
          (phase: string, resource: any) => {
            if (!resource || phase === 'BOOKMARK') return;
            const action = phase as 'ADDED' | 'MODIFIED' | 'DELETED';
            if (definition.kind === 'Event') this.state.applyEvent(action, resource);
            else this.state.apply(definition.kind, action, resource);
          },
          (error: unknown) => {
            if (error) this.state.recordError(`${definition.kind} watch ended: ${error instanceof Error ? error.message : String(error)}`);
            setTimeout(run, 1000);
          }
        );
      } catch (error) {
        this.state.recordError(`${definition.kind} watch could not start: ${error instanceof Error ? error.message : String(error)}`);
        setTimeout(run, 1000);
      }
    };
    void run();
  }
}
