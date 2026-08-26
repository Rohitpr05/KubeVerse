// The platform API is intentionally read-only: it projects Kubernetes state and streams incremental observations.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { ServerResponse } from 'node:http';
import type { ClusterResource, ClusterUpdate, TimelineEvent } from '@kubeverse/shared';
import { ClusterState } from './cluster-state.js';
import { KubernetesObserver } from './kubernetes-observer.js';
import { UnavailableMetricsProvider } from './metrics-provider.js';
import { registerIdentityRoutes } from './routes/identity.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerEnvironmentRoutes } from './routes/environment.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerArchitectureRoutes } from './routes/architecture.js';
import { registerExecutionRoutes } from './routes/execution.js';
import { registerLabRoutes } from './routes/lab.js';
import { ExperimentTracker } from './lab/experiments.js';

const port = Number(process.env.PLATFORM_PORT ?? 4000);
const host = process.env.PLATFORM_HOST ?? '127.0.0.1';
const namespaceFilter = (process.env.PLATFORM_NAMESPACES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
// Each connected SSE client is scoped to (at most) one active KubeVerse
// project, chosen by the browser tab that opened it (?projectId=...). A
// client with no project selected is never sent anything - the Playground's
// "no project open" state does not fall back to cluster-wide data.
const clients = new Map<ServerResponse, string | undefined>();

function sse(response: ServerResponse, event: string, data: unknown): void { response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function clusterNamespace(value: string): string | undefined { return value === '_' || value === 'cluster' ? undefined : value; }

// SYNC updates cover a whole watched kind at once (startup, watch reconnect)
// rather than one resource, so there is nothing to check ownership of - they
// are forwarded to every project-scoped client, who will then re-fetch their
// own project-scoped snapshot/graph and simply see no change if none of it
// was theirs. Every other action is only forwarded to a client whose active
// project actually owns the affected resource/event, so a change in one
// project's resources never redraws another project's Playground.
const state = new ClusterState((update: ClusterUpdate, resource?: ClusterResource, event?: TimelineEvent) => {
  for (const [client, projectId] of clients) {
    if (!projectId) continue;
    if (update.action === 'SYNC' || (update.kind === 'Event' ? state.isEventRelevantToProject(event, projectId) : state.isResourceOwnedByProject(resource, projectId))) {
      sse(client, 'cluster-update', update);
    }
  }
}, new Set(namespaceFilter));
const observer = new KubernetesObserver(state, namespaceFilter);
const metrics = new UnavailableMetricsProvider();
const experiments = new ExperimentTracker(state);

await app.register(cors, { origin: true });

registerIdentityRoutes(app);
registerSettingsRoutes(app);
registerEnvironmentRoutes(app);
registerProjectRoutes(app);
registerArchitectureRoutes(app);
registerExecutionRoutes(app);
registerLabRoutes(app, state, experiments);

app.get('/health', async () => ({ status: 'ok', service: 'platform-backend' }));
app.get('/live', async () => ({ status: 'alive', service: 'platform-backend' }));
app.get('/ready', async () => ({ status: state.snapshot().observerErrors.length === 0 ? 'ready' : 'degraded', diagnostics: observer.diagnosticsSnapshot() }));
app.get('/diagnostics', async () => observer.diagnosticsSnapshot());
// A `projectId` query param scopes the response to that KubeVerse project
// (backend/src/ownership.ts / ClusterState's project* methods); omitting it
// preserves the original cluster-wide behavior for direct/diagnostic use.
// The Playground always passes one - see frontend/src/views/PlaygroundView.tsx.
app.get('/snapshot', async (request) => {
  const { projectId } = request.query as { projectId?: string };
  return projectId ? state.projectSnapshot(projectId) : state.snapshot();
});
app.get('/resources', async (request) => state.resources(request.query as { kind?: string; namespace?: string; search?: string }));
app.get('/resource/:kind/:namespace/:name', async (request, reply) => {
  const { kind, namespace, name } = request.params as { kind: string; namespace: string; name: string };
  const detail = state.detail(kind, clusterNamespace(namespace), name);
  return detail ?? reply.code(404).send({ error: 'Resource not found' });
});
app.get('/timeline', async (request) => {
  const query = request.query as { limit?: string; namespace?: string; projectId?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 200), 1), 1000);
  return query.projectId ? state.projectTimeline(limit, query.projectId) : state.timeline(limit, query.namespace);
});
app.get('/graph', async (request) => {
  const query = request.query as { namespace?: string; projectId?: string };
  return query.projectId ? state.projectGraph(query.projectId) : state.graph(query.namespace);
});
app.get('/metrics', async (request) => ({ statistics: state.snapshot().statistics, metrics: await metrics.snapshot((request.query as { namespace?: string }).namespace) }));
app.get('/logs', async (request, reply) => {
  const query = request.query as { namespace?: string; name?: string; container?: string; tailLines?: string };
  if (!query.namespace || !query.name) return reply.code(400).send({ error: 'namespace and name are required' });
  try {
    const logs = await observer.readPodLogs(query.namespace, query.name, query.container, Math.min(Math.max(Number(query.tailLines ?? 200), 1), 2000));
    return { namespace: query.namespace, pod: query.name, container: query.container, logs, collectedAt: new Date().toISOString() };
  } catch (error) {
    request.log.warn({ error, namespace: query.namespace, pod: query.name }, 'pod log request failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message : 'Pod log request failed' });
  }
});
app.get('/events', (request, reply) => {
  const { projectId } = request.query as { projectId?: string };
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  response.flushHeaders();
  clients.set(response, projectId);
  sse(response, 'snapshot', projectId ? state.projectSnapshot(projectId) : state.snapshot());
  // Lab experiment updates (Phase 2) are forwarded on the same per-project
  // SSE stream, alongside cluster-update - one connection, one project scope,
  // same client-side filtering discipline as everything else on this stream.
  const unsubscribeLab = projectId ? experiments.subscribe(projectId, (experiment) => sse(response, 'lab-update', experiment)) : undefined;
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  request.raw.on('close', () => { clearInterval(heartbeat); clients.delete(response); unsubscribeLab?.(); });
});

try { await observer.start(); }
catch (error) { state.recordError(`Observer startup failed: ${error instanceof Error ? error.message : String(error)}`); app.log.error(error, 'observer startup failed'); }
await app.listen({ host, port });
