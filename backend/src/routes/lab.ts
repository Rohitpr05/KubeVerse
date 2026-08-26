// Phase 2 "Lab" routes: narrow, explicit, project-scoped Kubernetes
// mutations only (KUBEVERSE_MASTER_SPEC.md §3.3 - never an arbitrary
// kubectl/API proxy to the browser). Every mutating route in this file
// follows the same shape: resolve the project, resolve the target resource
// from currently-observed cluster state, verify the resource is actually
// owned by *this* project (backend/src/ownership.ts /
// ClusterState.isResourceOwnedByProject - never inferred from the name
// alone), verify its kind matches what the operation expects, perform the
// one fixed operation, and start a Lab experiment so the real, observed
// consequences show up in the Playground timeline.
import type { FastifyInstance } from 'fastify';
import type { ClusterResource } from '@kubeverse/shared';
import { ClusterState } from '../cluster-state.js';
import { deletePod, restartDeployment, scaleDeployment } from '../execution/kubernetesRunner.js';
import { ExperimentTracker } from '../lab/experiments.js';
import { runTrafficExperiment, type TrafficTarget } from '../lab/trafficRunner.js';
import { getProjectById, readGeneratedState, type ProjectSummary } from '../workspace.js';

const DEFAULT_HEALTH_PATH = '/health';

// The generated Node service's actual health path is whatever the NAM's
// healthCheck.path said (schema.ts defaults it to '/health', but a real
// architecture.md can override it) - reading it from the project's own
// generated-state.json is the only way to know the real path instead of
// guessing/hardcoding one that might 404 on a perfectly healthy service.
function healthPathFor(project: ProjectSummary, serviceName: string): string {
  const spec = readGeneratedState(project.path).spec;
  return spec?.services.find((service) => service.name === serviceName)?.healthCheck.path ?? DEFAULT_HEALTH_PATH;
}

interface ProjectParams { id: string; }
interface NamedTargetParams extends ProjectParams { name: string; }
interface ExperimentParams extends ProjectParams { experimentId: string; }

const MAX_TRAFFIC_REQUESTS = 5000;
const MAX_TRAFFIC_RPS = 100;
const MAX_REPLICAS = 10;

// A resource must carry this project's ownership label to be a valid target
// for ANY Lab mutation - this is the one and only authorization check every
// route below relies on, so it lives in one place. Returns undefined (never
// throws) for "not found" and "not owned by this project" alike: a caller
// outside the project must not be able to distinguish "wrong project" from
// "doesn't exist" for someone else's resource.
function resolveOwnedTarget(state: ClusterState, projectId: string, kind: string, namespace: string | undefined, name: string): ClusterResource | undefined {
  const resource = state.resourceByKey(kind, namespace, name);
  return resource && state.isResourceOwnedByProject(resource, projectId) ? resource : undefined;
}

export function registerLabRoutes(app: FastifyInstance, state: ClusterState, experiments: ExperimentTracker): void {
  const activeTraffic = new Map<string, AbortController>();

  // Lab Controls' target dropdowns (Deployments/Services/Pods to experiment
  // against) are populated from the Playground's own already-live,
  // already-project-scoped `/snapshot?projectId=` resources - there is no
  // separate "list lab targets" endpoint, since that would just be a second
  // way to fetch the exact same data.

  app.get('/api/projects/:id/lab/experiments', async (request, reply) => {
    const { id } = request.params as ProjectParams;
    if (!getProjectById(id)) return reply.code(404).send({ error: 'Project not found.' });
    return { experiments: experiments.list(id) };
  });

  app.get('/api/projects/:id/lab/experiments/:experimentId', async (request, reply) => {
    const { id, experimentId } = request.params as ExperimentParams;
    const experiment = experiments.get(id, experimentId);
    return experiment ?? reply.code(404).send({ error: 'Experiment not found.' });
  });

  // "Stop / Reset" (Part 1, Part 10): for an in-flight traffic experiment
  // this genuinely aborts the request loop. For a pod-failure/restart/scale
  // experiment there is nothing to undo - Kubernetes already performed the
  // real action - so this only stops KubeVerse from tracking further
  // transitions for it; the UI copy must not imply an undo.
  app.post('/api/projects/:id/lab/experiments/:experimentId/cancel', async (request, reply) => {
    const { id, experimentId } = request.params as ExperimentParams;
    if (!experiments.get(id, experimentId)) return reply.code(404).send({ error: 'Experiment not found.' });
    activeTraffic.get(experimentId)?.abort();
    experiments.cancel(experimentId);
    return experiments.get(id, experimentId);
  });

  app.post('/api/projects/:id/lab/pods/:name/fail', async (request, reply) => {
    const { id, name } = request.params as NamedTargetParams;
    const { namespace } = (request.body ?? {}) as { namespace?: string };
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if (!namespace) return reply.code(400).send({ error: 'namespace is required.' });

    const pod = resolveOwnedTarget(state, id, 'Pod', namespace, name);
    if (!pod) return reply.code(404).send({ error: 'Pod not found in this project.' });

    const experiment = experiments.start(id, 'pod-failure', pod, `Fail Pod ${pod.name}`);
    experiments.setRunning(experiment.id);
    const result = await deletePod(namespace, name);
    if (!result.ok) experiments.fail(experiment.id, result.output);
    return { experiment: experiments.get(id, experiment.id), result };
  });

  app.post('/api/projects/:id/lab/deployments/:name/restart', async (request, reply) => {
    const { id, name } = request.params as NamedTargetParams;
    const { namespace } = (request.body ?? {}) as { namespace?: string };
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if (!namespace) return reply.code(400).send({ error: 'namespace is required.' });

    const deployment = resolveOwnedTarget(state, id, 'Deployment', namespace, name);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found in this project.' });

    const experiment = experiments.start(id, 'restart', deployment, `Restart ${deployment.name}`);
    experiments.setRunning(experiment.id);
    const result = await restartDeployment(namespace, name);
    if (!result.ok) experiments.fail(experiment.id, result.output);
    return { experiment: experiments.get(id, experiment.id), result };
  });

  app.post('/api/projects/:id/lab/deployments/:name/scale', async (request, reply) => {
    const { id, name } = request.params as NamedTargetParams;
    const { namespace, replicas } = (request.body ?? {}) as { namespace?: string; replicas?: number };
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if (!namespace) return reply.code(400).send({ error: 'namespace is required.' });
    if (!Number.isInteger(replicas) || replicas! < 0 || replicas! > MAX_REPLICAS) {
      return reply.code(400).send({ error: `replicas must be an integer between 0 and ${MAX_REPLICAS}.` });
    }

    const deployment = resolveOwnedTarget(state, id, 'Deployment', namespace, name);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found in this project.' });

    const experiment = experiments.start(id, 'scale', deployment, `Scale ${deployment.name} to ${replicas}`);
    experiments.setRunning(experiment.id);
    const result = await scaleDeployment(namespace, name, replicas!);
    if (!result.ok) experiments.fail(experiment.id, result.output);
    return { experiment: experiments.get(id, experiment.id), result };
  });

  app.post('/api/projects/:id/lab/traffic', async (request, reply) => {
    const { id } = request.params as ProjectParams;
    const body = (request.body ?? {}) as { serviceNamespace?: string; serviceName?: string; requests?: number; requestsPerSecond?: number };
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if (!body.serviceNamespace || !body.serviceName) return reply.code(400).send({ error: 'serviceNamespace and serviceName are required.' });
    const requests = Math.min(Math.max(Math.trunc(body.requests ?? 0), 1), MAX_TRAFFIC_REQUESTS);
    const requestsPerSecond = Math.min(Math.max(Math.trunc(body.requestsPerSecond ?? 0), 1), MAX_TRAFFIC_RPS);

    const service = resolveOwnedTarget(state, id, 'Service', body.serviceNamespace, body.serviceName);
    if (!service) return reply.code(404).send({ error: 'Service not found in this project.' });
    const port = service.servicePorts?.[0];
    if (!port) return reply.code(400).send({ error: 'Service has no declared port.' });

    // The same real selector-match the graph builder already computed
    // (resource-graph.ts's 'selects' edges) - never a re-implementation of
    // Service->Pod resolution, and restricted to currently-Ready Pods, which
    // is exactly the condition that determines real Kubernetes Endpoints.
    const graph = state.projectGraph(id);
    const readyPodUids = new Set(
      graph.edges.filter((edge) => edge.relation === 'selects' && edge.source === service.uid).map((edge) => edge.target),
    );
    const targets: TrafficTarget[] = [...readyPodUids]
      .map((uid) => state.resourceByUid(uid))
      .filter((resource): resource is ClusterResource => Boolean(resource && resource.status.includes('(Ready)') && resource.namespace))
      .map((resource) => ({ namespace: resource.namespace!, podName: resource.name }));

    if (targets.length === 0) {
      return reply.code(409).send({ error: 'Service has no reachable (Ready) endpoint. Deploy the project and wait for its Pods to become Ready before generating traffic.' });
    }

    const experiment = experiments.start(id, 'traffic', service, `Generate traffic: ${requests} requests to ${service.name}`);
    const controller = new AbortController();
    activeTraffic.set(experiment.id, controller);
    experiments.setRunning(experiment.id);

    void runTrafficExperiment({
      totalRequests: requests, requestsPerSecond, path: healthPathFor(project, service.name), remotePort: port.targetPort,
      targets, signal: controller.signal,
      onProgress: (stats) => experiments.updateTraffic(experiment.id, stats),
    })
      .then(() => { if (controller.signal.aborted) experiments.cancel(experiment.id); else experiments.completeTraffic(experiment.id); })
      .catch((error: unknown) => experiments.fail(experiment.id, error instanceof Error ? error.message : String(error)))
      .finally(() => activeTraffic.delete(experiment.id));

    return experiments.get(id, experiment.id);
  });
}
