import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSettled, canContinue, continueLabel, explainFailure, INITIAL_CHECKS, type Check } from './onboardingLogic.js';

function checksWith(overrides: Partial<Record<string, Check['state']>>): Check[] {
  return INITIAL_CHECKS.map((check) => ({ ...check, state: overrides[check.key] ?? check.state }));
}

// --- allSettled ---

test('allSettled is false while any check is still "checking" (the initial state)', () => {
  assert.equal(allSettled(INITIAL_CHECKS), false);
});

test('allSettled is true once every check has resolved to ok or unavailable', () => {
  const checks = checksWith({ backend: 'ok', docker: 'ok', kubernetes: 'unavailable', kubectl: 'ok' });
  assert.equal(allSettled(checks), true);
});

// --- canContinue: the backend is the only non-optional dependency ---

test('canContinue is false while checks are still running, even if backend already resolved ok', () => {
  const checks = checksWith({ backend: 'ok' }); // docker/kubernetes/kubectl still "checking"
  assert.equal(canContinue(checks), false);
});

test('canContinue is true once settled, as long as the backend itself is ok - Docker/Kubernetes/kubectl are optional', () => {
  const checks = checksWith({ backend: 'ok', docker: 'unavailable', kubernetes: 'unavailable', kubectl: 'unavailable' });
  assert.equal(canContinue(checks), true);
});

test('canContinue is false when the backend itself is unavailable, even if everything else is fine - there is no app to continue into', () => {
  const checks = checksWith({ backend: 'unavailable', docker: 'ok', kubernetes: 'ok', kubectl: 'ok' });
  assert.equal(canContinue(checks), false);
});

// --- continueLabel ---

test('continueLabel is "Continue" when every check passed', () => {
  const checks = checksWith({ backend: 'ok', docker: 'ok', kubernetes: 'ok', kubectl: 'ok' });
  assert.equal(continueLabel(checks), 'Continue');
});

test('continueLabel is "Continue Anyway" when at least one optional dependency failed', () => {
  const checks = checksWith({ backend: 'ok', docker: 'unavailable', kubernetes: 'ok', kubectl: 'ok' });
  assert.equal(continueLabel(checks), 'Continue Anyway');
});

// --- explainFailure: honest, non-generic copy per dependency ---

test('explainFailure gives Docker-specific guidance', () => {
  assert.match(explainFailure('docker', undefined), /Docker/);
  assert.match(explainFailure('docker', undefined), /Start Docker/);
});

test('explainFailure gives Kubernetes-specific guidance', () => {
  assert.match(explainFailure('kubernetes', undefined), /cluster/i);
});

test('explainFailure gives kubectl-specific guidance', () => {
  assert.match(explainFailure('kubectl', undefined), /kubectl/);
});

test('explainFailure includes the real detail string when one is provided, rather than only the generic guidance', () => {
  const message = explainFailure('docker', 'Cannot connect to the Docker daemon');
  assert.match(message, /Cannot connect to the Docker daemon/);
});
