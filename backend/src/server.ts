// The platform API is intentionally read-only: it projects Kubernetes state and streams incremental observations.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { ServerResponse } from 'node:http';
import type { ClusterUpdate } from '@simulator/shared/platform-contract';
import { ClusterState } from './cluster-state.js';
import { KubernetesObserver } from './kubernetes-observer.js';
import { UnavailableMetricsProvider } from './metrics-provider.js';

const port = Number(process.env.PLATFORM_PORT ?? 4000);
const host = process.env.PLATFORM_HOST ?? '127.0.0.1';
const namespaceFilter = (process.env.PLATFORM_NAMESPACES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const clients = new Set<ServerResponse>();

function sse(response: ServerResponse, event: string, data: unknown): void { response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function clusterNamespace(value: string): string | undefined { return value === '_' || value === 'cluster' ? undefined : value; }

const state = new ClusterState((update: ClusterUpdate) => {
  for (const client of clients) sse(client, 'cluster-update', update);
}, new Set(namespaceFilter));
const observer = new KubernetesObserver(state, namespaceFilter);
const metrics = new UnavailableMetricsProvider();

await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok', service: 'platform-backend' }));
app.get('/live', async () => ({ status: 'alive', service: 'platform-backend' }));
app.get('/ready', async () => ({ status: state.snapshot().observerErrors.length === 0 ? 'ready' : 'degraded', diagnostics: observer.diagnosticsSnapshot() }));
app.get('/diagnostics', async () => observer.diagnosticsSnapshot());
app.get('/snapshot', async () => state.snapshot());
app.get('/resources', async (request) => state.resources(request.query as { kind?: string; namespace?: string; search?: string }));
app.get('/resource/:kind/:namespace/:name', async (request, reply) => {
  const { kind, namespace, name } = request.params as { kind: string; namespace: string; name: string };
  const detail = state.detail(kind, clusterNamespace(namespace), name);
  return detail ?? reply.code(404).send({ error: 'Resource not found' });
});
app.get('/timeline', async (request) => {
  const query = request.query as { limit?: string; namespace?: string };
  return state.timeline(Math.min(Math.max(Number(query.limit ?? 200), 1), 1000), query.namespace);
});
app.get('/graph', async (request) => state.graph((request.query as { namespace?: string }).namespace));
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
app.get('/simulator/traffic', async (_request, reply) => {
  const gateway = state.resources({ kind: 'Pod', search: 'gateway' }).find((resource) => resource.labels.app === 'gateway' && resource.namespace);
  if (!gateway?.namespace) return { events: [], message: 'No running Gateway Pod is currently observable.' };
  try {
    const response = await observer.readPodProxy(gateway.namespace, gateway.name, 'events');
    const parsed = typeof response === 'string' ? JSON.parse(response) : response;
    return { events: parsed.events ?? [], gatewayPod: gateway.name };
  } catch (error) {
    _request.log.warn({ error }, 'gateway traffic event proxy failed');
    return reply.code(502).send({ events: [], error: error instanceof Error ? error.message : 'Gateway event proxy failed' });
  }
});
app.get('/events', (request, reply) => {
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  response.flushHeaders();
  clients.add(response);
  sse(response, 'snapshot', state.snapshot());
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  request.raw.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
});

try { await observer.start(); }
catch (error) { state.recordError(`Observer startup failed: ${error instanceof Error ? error.message : String(error)}`); app.log.error(error, 'observer startup failed'); }
await app.listen({ host, port });
