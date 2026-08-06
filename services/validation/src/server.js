// Validation accepts only document metadata and validation options; it cannot see other pipeline settings.
import { createConfig, createEventStore, createLogger, createMetrics, createServiceServer, delay, HttpError, json } from '@simulator/shared';

const config = createConfig({ serviceName: 'validation-service', port: 3001 });
const logger = createLogger(config);
const events = createEventStore(config);
const metrics = createMetrics(config);

createServiceServer({ config, events, metrics, logger, route: async ({ request, response, url, body, requestId }) => {
  if (request.method !== 'POST' || url.pathname !== '/validate') return json(response, 404, { error: 'Route not found', requestId });
  if (!body.document || !body.config || !Array.isArray(body.config.checks)) throw new HttpError(400, 'Validation requires document metadata and validation config.');
  const startedAt = Date.now();
  const { document, config: validationConfig } = body;
  const simulatedProcessingMs = 100 + validationConfig.checks.length * 55;
  const simulatedCpuPercent = 10 + validationConfig.checks.length * 6;
  const simulatedMemoryMb = 64 + validationConfig.checks.length * 4;
  events.emit('REQUEST_RECEIVED', requestId, { route: '/validate' });
  events.emit('SERVICE_STARTED', requestId, { operation: 'dummy_validation' });
  logger.info('request_received', { requestId });
  logger.info('processing_started', { requestId, operation: 'dummy_validation' });
  logger.info('configuration_used', { requestId, validation: validationConfig });
  await delay(simulatedProcessingMs);
  const result = { valid: document.name !== 'invalid-demo', completedChecks: validationConfig.checks };
  const simulatedLatencyMs = Date.now() - startedAt;
  events.emit('SERVICE_COMPLETED', requestId, { simulatedLatencyMs });
  logger.info('processing_completed', { requestId, elapsedMs: simulatedLatencyMs });
  json(response, 200, { requestId, service: config.serviceName, simulatedProcessingMs, simulatedCpuPercent, simulatedMemoryMb, simulatedLatencyMs, result, simulated: true });
}}).listen();
