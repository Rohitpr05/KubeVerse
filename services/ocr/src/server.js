// OCR accepts only document metadata and OCR options; it simulates extraction without OCR or AI dependencies.
import { createConfig, createEventStore, createLogger, createMetrics, createServiceServer, delay, HttpError, json } from '@simulator/shared';

const config = createConfig({ serviceName: 'ocr-service', port: 3003 });
const logger = createLogger(config);
const events = createEventStore(config);
const metrics = createMetrics(config);

createServiceServer({ config, events, metrics, logger, route: async ({ request, response, url, body, requestId }) => {
  if (request.method !== 'POST' || url.pathname !== '/extract') return json(response, 404, { error: 'Route not found', requestId });
  if (!body.document || !body.config || !['normal', 'high'].includes(body.config.accuracy)) throw new HttpError(400, 'OCR requires document metadata and OCR config.');
  const startedAt = Date.now();
  const { document, config: ocrConfig } = body;
  const simulatedProcessingMs = (ocrConfig.accuracy === 'high' ? 1200 : 400) + (ocrConfig.extractTables ? 350 : 0) + (ocrConfig.languageDetection ? 200 : 0);
  const simulatedCpuPercent = (ocrConfig.accuracy === 'high' ? 70 : 25) + (ocrConfig.extractTables ? 12 : 0) + (ocrConfig.languageDetection ? 6 : 0);
  const simulatedMemoryMb = (ocrConfig.accuracy === 'high' ? 192 : 96) + (ocrConfig.extractTables ? 48 : 0) + (ocrConfig.languageDetection ? 16 : 0);
  events.emit('REQUEST_RECEIVED', requestId, { route: '/extract' });
  events.emit('SERVICE_STARTED', requestId, { operation: 'dummy_ocr' });
  logger.info('request_received', { requestId });
  logger.info('processing_started', { requestId, operation: 'dummy_ocr' });
  logger.info('configuration_used', { requestId, ocr: ocrConfig });
  await delay(simulatedProcessingMs);
  const text = ocrConfig.extractText ? `Simulated text extracted from ${document.name}.` : undefined;
  const simulatedLatencyMs = Date.now() - startedAt;
  events.emit('SERVICE_COMPLETED', requestId, { simulatedLatencyMs });
  logger.info('processing_completed', { requestId, elapsedMs: simulatedLatencyMs });
  json(response, 200, { requestId, service: config.serviceName, simulatedProcessingMs, simulatedCpuPercent, simulatedMemoryMb, simulatedLatencyMs, result: { text, tablesExtracted: ocrConfig.extractTables ? 2 : 0, detectedLanguage: ocrConfig.languageDetection ? 'en' : undefined, accuracy: ocrConfig.accuracy }, simulated: true });
}}).listen();
