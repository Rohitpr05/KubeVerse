// These fast tests protect the Gateway's request-boundary rules without needing Docker or open ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProcessRequest } from '@simulator/shared';

const document = { name: 'invoice.pdf', type: 'invoice', mimeType: 'application/pdf', size: 1024 };

test('normalizes omitted, disabled pipeline sections', () => {
  const outcome = validateProcessRequest({ document, pipeline: { validation: { enabled: true, checks: ['schema'] } } });
  assert.equal(outcome.valid, true);
  assert.equal(outcome.value.pipeline.validation.enabled, true);
  assert.equal(outcome.value.pipeline.security.enabled, false);
  assert.equal(outcome.value.pipeline.ocr.enabled, false);
});

test('rejects a request with no enabled services', () => {
  const outcome = validateProcessRequest({ document, pipeline: {} });
  assert.equal(outcome.valid, false);
  assert.match(outcome.errors.join(' '), /At least one pipeline service/);
});

test('rejects semantically invalid deep scan configuration', () => {
  const outcome = validateProcessRequest({ document, pipeline: { security: { enabled: true, malwareScan: false, deepScan: true } } });
  assert.equal(outcome.valid, false);
  assert.match(outcome.errors.join(' '), /requires malwareScan/);
});
