import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as k8s from '@kubernetes/client-node';

const execFileAsync = promisify(execFile);

// Real, narrow Kubernetes mutations for the Lab experiment engine
// (KUBEVERSE_MASTER_SPEC.md Phase 2, "controlled experiments"). These are
// the only three ways KubeVerse ever mutates a real cluster on the browser's
// behalf - never an arbitrary kubectl/API proxy (backend/src/routes/lab.ts
// is what restricts *which* resource each call may target; this module just
// performs the actual, fixed operation once a route has already verified
// project ownership).
//
// KubernetesObjectApi.patch() defaults to a Strategic Merge Patch (the same
// content-type `kubectl patch`/`kubectl scale`/`kubectl rollout restart` use
// by default) - a plain object literal patches in the expected "merge, don't
// replace whole object" way, so scaleDeployment/restartDeployment can stay
// simple partial specs instead of hand-built JSON-Patch arrays.
//
// Deliberately NOT constructed once at module load: k8s.KubeConfig#makeApiClient
// throws synchronously ("No active cluster!") the moment the local kubeconfig
// has no current context - an entirely ordinary local state (Docker Desktop's
// Kubernetes not running yet, or having just crashed) that must never crash
// the whole backend process just because this module got imported. Building a
// fresh KubeConfig/client on every call is also what makes these operations
// self-healing: if the cluster becomes reachable again later in the same
// backend process, the very next call picks that up by re-reading the
// kubeconfig, rather than being stuck with a client built from a stale (or
// never-successful) snapshot.
function freshKubeConfig(): k8s.KubeConfig {
  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromDefault();
  return kubeConfig;
}

function freshObjectApi(): k8s.KubernetesObjectApi {
  return k8s.KubernetesObjectApi.makeApiClient(freshKubeConfig());
}

function describeK8sError(error: unknown): string {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = (error as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function deletePod(namespace: string, name: string): Promise<{ ok: boolean; output: string }> {
  try {
    await freshObjectApi().delete({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace } });
    return { ok: true, output: `Pod ${namespace}/${name} deletion requested.` };
  } catch (error) {
    return { ok: false, output: describeK8sError(error) };
  }
}

export async function scaleDeployment(namespace: string, name: string, replicas: number): Promise<{ ok: boolean; output: string }> {
  try {
    await freshObjectApi().patch({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace }, spec: { replicas } } as k8s.KubernetesObject);
    return { ok: true, output: `Deployment ${namespace}/${name} scale requested: ${replicas} replicas.` };
  } catch (error) {
    return { ok: false, output: describeK8sError(error) };
  }
}

// Equivalent to `kubectl rollout restart deployment/<name>`: patches the Pod
// template's annotations so its hash changes, which makes the Deployment
// controller perform a real rolling replacement of every Pod - there is no
// separate "restart a single container in place" Kubernetes primitive, so
// this (workload-level restart) is the real operation behind the Lab's
// "Restart" control.
export async function restartDeployment(namespace: string, name: string): Promise<{ ok: boolean; output: string }> {
  try {
    await freshObjectApi().patch({
      apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace },
      spec: { template: { metadata: { annotations: { 'kubeverse.dev/restarted-at': new Date().toISOString() } } } },
    } as k8s.KubernetesObject);
    return { ok: true, output: `Deployment ${namespace}/${name} rolling restart requested.` };
  } catch (error) {
    return { ok: false, output: describeK8sError(error) };
  }
}

// Native (no `kubectl` subprocess) port-forward for the Lab traffic
// generator: opens a real Kubernetes API server port-forward stream directly
// to one specific, already-selected backing Pod and returns a local TCP
// listener proxying onto it. Forwarding to one concrete Pod (rather than a
// Service) is deliberate - see lab/trafficRunner.ts for why.
export async function openPodPortForward(namespace: string, podName: string, targetPort: number): Promise<{ localPort: number; close: () => void }> {
  const net = await import('node:net');
  const forward = new k8s.PortForward(freshKubeConfig());
  const server = net.createServer((socket) => {
    void forward.portForward(namespace, podName, [targetPort], socket, null, socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const localPort = typeof address === 'object' && address ? address.port : 0;
  return { localPort, close: () => server.close() };
}

export async function checkKubectlAvailable(): Promise<{ available: boolean; context?: string; server?: string; error?: string }> {
  try {
    const { stdout: context } = await execFileAsync('kubectl', ['config', 'current-context'], { timeout: 3000 });
    const server = await execFileAsync('kubectl', ['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}'], { timeout: 3000 })
      .then(({ stdout }) => stdout.trim() || undefined)
      .catch(() => undefined);
    return { available: true, context: context.trim(), server };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'kubectl command failed' };
  }
}

export async function applyManifests(kubernetesDir: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('kubectl', ['apply', '-f', kubernetesDir, '--recursive'], { timeout: 60_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteNamespace(namespace: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('kubectl', ['delete', 'namespace', namespace], { timeout: 60_000 });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
