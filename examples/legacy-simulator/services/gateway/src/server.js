// The Gateway owns input validation, service selection, concurrent fan-out, and response aggregation.
import {
  createConfig, createEventStore, createLogger, createMetrics, createServiceServer,
  HttpError, json, requestJson, validateProcessRequest
} from '@simulator/shared';

const config = createConfig({ serviceName: 'gateway-api', port: 3000, extra: {
  validationUrl: process.env.VALIDATION_URL ?? 'http://validation:3001',
  securityUrl: process.env.SECURITY_URL ?? 'http://security:3002',
  ocrUrl: process.env.OCR_URL ?? 'http://ocr:3003'
} });
const logger = createLogger(config);
const events = createEventStore(config);
const metrics = createMetrics(config);

function pipelineTargets(payload) {
  return [
    { key: 'validation', service: 'validation-service', endpoint: `${config.validationUrl}/validate`, body: { document: payload.document, config: payload.pipeline.validation } },
    { key: 'security', service: 'security-service', endpoint: `${config.securityUrl}/scan`, body: { document: payload.document, config: payload.pipeline.security } },
    { key: 'ocr', service: 'ocr-service', endpoint: `${config.ocrUrl}/extract`, body: { document: payload.document, config: payload.pipeline.ocr } }
  ];
}

createServiceServer({ config, events, metrics, logger, route: async ({ request, response, url, body, requestId }) => {
  if (request.method !== 'POST' || url.pathname !== '/api/process') return json(response, 404, { error: 'Route not found', requestId });

  events.emit('REQUEST_RECEIVED', requestId, { route: '/api/process' });
  logger.info('request_received', { requestId, route: '/api/process' });
  const validation = validateProcessRequest(body);
  if (!validation.valid) {
    events.emit('SERVICE_FAILED', requestId, { stage: 'request_validation', errors: validation.errors });
    logger.error('request_validation_failed', { requestId, errors: validation.errors });
    throw new HttpError(400, 'Request validation failed.', validation.errors);
  }

  const payload = validation.value;
  events.emit('REQUEST_VALIDATED', requestId, { documentName: payload.document.name });
  logger.info('request_validated', { requestId, document: payload.document });

  const selected = [];
  for (const target of pipelineTargets(payload)) {
    if (target.body.config.enabled) {
      selected.push(target);
      events.emit('SERVICE_SELECTED', requestId, { targetService: target.service });
      logger.info('service_selected', { requestId, targetService: target.service });
    } else {
      events.emit('SERVICE_SKIPPED', requestId, { targetService: target.service, reason: 'disabled_by_pipeline' });
      logger.info('service_skipped', { requestId, targetService: target.service, reason: 'disabled_by_pipeline' });
    }
  }

  try {
    const results = await Promise.all(selected.map(async (target) => {
      events.emit('SERVICE_STARTED', requestId, { targetService: target.service });
      const result = await requestJson(target.endpoint, { method: 'POST', body: target.body, requestId });
      events.emit('SERVICE_COMPLETED', requestId, { targetService: target.service, simulatedLatencyMs: result.simulatedLatencyMs });
      return [target.key, result];
    }));
    const services = Object.fromEntries(results);
    events.emit('RESPONSE_AGGREGATED', requestId, { selectedServices: selected.map((target) => target.key) });
    events.emit('REQUEST_COMPLETED', requestId, { outcome: 'success' });
    logger.info('response_aggregated', { requestId, selectedServices: selected.map((target) => target.key) });
    json(response, 200, { requestId, status: 'completed', document: payload.document, selectedServices: selected.map((target) => target.key), services, simulated: true });
  } catch (error) {
    events.emit('SERVICE_FAILED', requestId, { stage: 'downstream', error: error.message });
    events.emit('REQUEST_COMPLETED', requestId, { outcome: 'failed' });
    logger.error('downstream_processing_failed', { requestId, error: error.message });
    throw error;
  }
}}).listen();
