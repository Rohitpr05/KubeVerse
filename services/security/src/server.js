// Security accepts only document metadata and its own scan configuration; no external scanner is called.
import { createConfig, createEventStore, createLogger, createMetrics, createServiceServer, delay, HttpError, json } from '@simulator/shared';

const config = createConfig({ serviceName: 'security-service', port: 3002 });
const logger = createLogger(config);
const events = createEventStore(config);
const metrics = createMetrics(config);

createServiceServer({ config, events, metrics, logger, route: async ({ request, response, url, body, requestId }) => {
  if (request.method !== 'POST' || url.pathname !== '/scan') return json(response, 404, { error: 'Route not found', requestId });
  if (!body.document || !body.config || typeof body.config.malwareScan !== 'boolean' || typeof body.config.deepScan !== 'boolean') throw new HttpError(400, 'Security requires document metadata and security config.');
  const startedAt = Date.now();
  const { document, config: securityConfig } = body;
  const simulatedProcessingMs = 200 + (securityConfig.malwareScan ? 250 : 0) + (securityConfig.deepScan ? 600 : 0);
  const simulatedCpuPercent = 12 + (securityConfig.malwareScan ? 15 : 0) + (securityConfig.deepScan ? 35 : 0);
  const simulatedMemoryMb = 72 + (securityConfig.malwareScan ? 12 : 0) + (securityConfig.deepScan ? 36 : 0);
  events.emit('REQUEST_RECEIVED', requestId, { route: '/scan' });
  events.emit('SERVICE_STARTED', requestId, { operation: 'dummy_security_scan' });
  logger.info('request_received', { requestId });
  logger.info('processing_started', { requestId, operation: 'dummy_security_scan' });
  logger.info('configuration_used', { requestId, security: securityConfig });
  await delay(simulatedProcessingMs);
  const safe = document.name !== 'blocked-demo';
  const simulatedLatencyMs = Date.now() - startedAt;
  events.emit('SERVICE_COMPLETED', requestId, { simulatedLatencyMs });
  logger.info('processing_completed', { requestId, elapsedMs: simulatedLatencyMs });
  json(response, 200, { requestId, service: config.serviceName, simulatedProcessingMs, simulatedCpuPercent, simulatedMemoryMb, simulatedLatencyMs, result: { safe, riskLevel: safe ? 'low' : 'high', scanDepth: securityConfig.deepScan ? 'deep' : 'standard' }, simulated: true });
}}).listen();
