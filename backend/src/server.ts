// The Phase 1 platform API exposes a snapshot and an SSE stream; it does not mutate the cluster.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { ServerResponse } from 'node:http';
import type { ClusterSnapshot, ClusterUpdate } from '@simulator/shared/platform-contract';
import { ClusterState } from './cluster-state.js';
import { KubernetesObserver } from './kubernetes-observer.js';

const port = Number(process.env.PLATFORM_PORT ?? 4000);
const host = process.env.PLATFORM_HOST ?? '127.0.0.1';
const app = Fastify({ logger: true });
const clients = new Set<ServerResponse>();

function writeEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(update: ClusterUpdate, snapshot: ClusterSnapshot): void {
  for (const client of clients) writeEvent(client, 'cluster-update', { update, snapshot });
}

const state = new ClusterState(broadcast);
const observer = new KubernetesObserver(state);

await app.register(cors, { origin: true });

app.get('/snapshot', async () => state.snapshot());

app.get('/events', (request, reply) => {
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });
  response.flushHeaders();
  clients.add(response);
  writeEvent(response, 'snapshot', state.snapshot());
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  request.raw.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
});

try {
  await observer.start();
} catch (error) {
  state.recordError(`Observer startup failed: ${error instanceof Error ? error.message : String(error)}`);
}

await app.listen({ host, port });
