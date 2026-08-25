import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function json(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON'); }
}

// The common server supplies probes and observability before handing business routes to a service.
export function createServiceServer({ config, events, metrics, logger, route }) {
  const server = http.createServer(async (request, response) => {
    const requestId = request.headers['x-request-id'] ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    const startedAt = metrics.begin();
    let failed = false;
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok', service: config.serviceName });
      if (request.method === 'GET' && url.pathname === '/live') return json(response, 200, { status: 'alive', service: config.serviceName });
      if (request.method === 'GET' && url.pathname === '/ready') return json(response, 200, { status: 'ready', service: config.serviceName });
      if (request.method === 'GET' && url.pathname === '/info') return json(response, 200, { serviceName: config.serviceName, instanceId: config.instanceId, environment: process.env.NODE_ENV ?? 'local' });
      if (request.method === 'GET' && url.pathname === '/metrics') return json(response, 200, metrics.snapshot());
      if (request.method === 'GET' && url.pathname === '/events') return json(response, 200, { events: events.recent(Number(url.searchParams.get('limit') ?? 100)) });
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await readJson(request) : {};
      await route({ request, response, url, body, requestId });
    } catch (error) {
      failed = true;
      logger.error('request_failed', { requestId, error: error.message });
      events.emit('SERVICE_FAILED', requestId, { error: error.message });
      if (!response.headersSent) json(response, error.statusCode ?? (error.message === 'Request body must be valid JSON' ? 400 : 500), { error: error.message, details: error.details, requestId });
    } finally {
      metrics.finish(startedAt, failed);
    }
  });
  return { listen: () => server.listen(config.port, () => logger.info('service_listening', { port: config.port })), server };
}

// Native fetch avoids an HTTP client dependency and makes the inter-service boundary explicit.
export async function requestJson(url, { method = 'GET', body, requestId, timeoutMs = 5000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { method, signal, headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Downstream ${url} returned ${response.status}: ${payload.error ?? 'unknown error'}`);
  return payload;
}
