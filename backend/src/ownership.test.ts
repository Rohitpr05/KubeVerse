import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnedByProject, ownershipLabels, sanitizeLabelValue, MANAGED_BY_LABEL, MANAGED_BY_VALUE, PROJECT_ID_LABEL, PROJECT_NAME_LABEL } from './ownership.js';

// Kubernetes label values must match (([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?
// and be <= 63 characters.
const LABEL_VALUE_PATTERN = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/;

test('sanitizeLabelValue produces a legal Kubernetes label value for a real project name containing a space', () => {
  const sanitized = sanitizeLabelValue('TEST -001');
  assert.match(sanitized, LABEL_VALUE_PATTERN);
  assert.equal(sanitized, 'TEST-001');
});

test('sanitizeLabelValue strips leading/trailing punctuation and collapses runs of invalid characters', () => {
  assert.equal(sanitizeLabelValue('  my project!! '), 'my-project');
  assert.match(sanitizeLabelValue('  my project!! '), LABEL_VALUE_PATTERN);
});

test('sanitizeLabelValue truncates to 63 characters and never produces an empty/illegal value', () => {
  const long = sanitizeLabelValue('a'.repeat(200));
  assert.ok(long.length <= 63);
  assert.match(long, LABEL_VALUE_PATTERN);

  const emptyish = sanitizeLabelValue('!!!   !!!');
  assert.equal(emptyish, 'project');
  assert.match(emptyish, LABEL_VALUE_PATTERN);
});

test('ownershipLabels sets the managed-by, project-id, and sanitized project-name labels', () => {
  const labels = ownershipLabels({ id: '01a037bf-5bff-7285-a0d0-0d8e79272479', name: 'TEST -001' });
  assert.equal(labels[MANAGED_BY_LABEL], MANAGED_BY_VALUE);
  assert.equal(labels[PROJECT_ID_LABEL], '01a037bf-5bff-7285-a0d0-0d8e79272479');
  assert.equal(labels[PROJECT_NAME_LABEL], 'TEST-001');
});

test('isOwnedByProject matches only on an exact project-id label value, never a partial/loose match', () => {
  const labels = ownershipLabels({ id: 'project-a', name: 'a' });
  assert.equal(isOwnedByProject(labels, 'project-a'), true);
  assert.equal(isOwnedByProject(labels, 'project-b'), false);
  assert.equal(isOwnedByProject(labels, 'project'), false);
  assert.equal(isOwnedByProject(undefined, 'project-a'), false);
  assert.equal(isOwnedByProject({}, 'project-a'), false);
});
