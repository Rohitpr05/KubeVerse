import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LabExperiment } from '@kubeverse/shared';
import { failingPodKeyFor, highlightedKeysFor, nodeKey } from './experimentHighlight.js';

function podFailure(overrides: Partial<LabExperiment> = {}): LabExperiment {
  return {
    id: 'exp-1', projectId: 'proj-a', kind: 'pod-failure',
    target: { kind: 'Pod', namespace: 'ns', name: 'backend-c' },
    action: 'Fail Pod backend-c', startedAt: '2026-01-01T00:00:00Z', status: 'running', transitions: [],
    ...overrides,
  };
}

function restart(overrides: Partial<LabExperiment> = {}): LabExperiment {
  return {
    id: 'exp-2', projectId: 'proj-a', kind: 'restart',
    target: { kind: 'Deployment', namespace: 'ns', name: 'backend' },
    action: 'Restart backend', startedAt: '2026-01-01T00:00:00Z', status: 'running', transitions: [],
    ...overrides,
  };
}

function traffic(overrides: Partial<LabExperiment> = {}): LabExperiment {
  return {
    id: 'exp-3', projectId: 'proj-a', kind: 'traffic',
    target: { kind: 'Service', namespace: 'ns', name: 'backend' },
    action: 'Generate traffic', startedAt: '2026-01-01T00:00:00Z', status: 'running', transitions: [],
    ...overrides,
  };
}

// --- Pod failure state: only the selected Pod, never siblings ---

test('a running pod-failure experiment marks exactly the targeted Pod as failing', () => {
  const key = failingPodKeyFor(podFailure());
  assert.equal(key, nodeKey('Pod', 'ns', 'backend-c'));
});

test('failingPodKeyFor never marks an unrelated sibling Pod - it is always the exact target, never derived from other names', () => {
  const key = failingPodKeyFor(podFailure());
  assert.notEqual(key, nodeKey('Pod', 'ns', 'backend-a'));
  assert.notEqual(key, nodeKey('Pod', 'ns', 'backend-b'));
  assert.notEqual(key, nodeKey('Pod', 'ns', 'backend-d'));
  assert.notEqual(key, nodeKey('Pod', 'ns', 'backend-e'));
});

test('failingPodKeyFor ignores transitions entirely, so a replacement Pod appearing under the same experiment never becomes the failing key', () => {
  const withReplacementTransition = podFailure({
    transitions: [
      { timestamp: 't1', kind: 'Pod', name: 'backend-c', status: 'Terminated', note: 'Pod backend-c terminated' },
      { timestamp: 't2', kind: 'Pod', name: 'backend-f', status: 'Pending', note: 'Pod backend-f: Pending' },
    ],
  });
  assert.equal(failingPodKeyFor(withReplacementTransition), nodeKey('Pod', 'ns', 'backend-c'));
});

// --- State clears correctly ---

test('failingPodKeyFor is undefined once the experiment is no longer live (completed/failed/cancelled)', () => {
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    assert.equal(failingPodKeyFor(podFailure({ status })), undefined, `status=${status}`);
  }
});

test('failingPodKeyFor is undefined when there is no active experiment at all (e.g. after a project switch resets it)', () => {
  assert.equal(failingPodKeyFor(undefined), undefined);
});

test('failingPodKeyFor only applies to pod-failure experiments, not restart/scale/traffic', () => {
  assert.equal(failingPodKeyFor(restart()), undefined);
  assert.equal(failingPodKeyFor(traffic()), undefined);
});

// --- Generic highlight ring: unaffected by pod-failure, still works for restart/scale ---

test('highlightedKeysFor returns null for a pod-failure experiment (it has its own separate treatment)', () => {
  assert.equal(highlightedKeysFor(podFailure()), null);
});

test('highlightedKeysFor returns null for a traffic experiment (already visualized by traffic particles)', () => {
  assert.equal(highlightedKeysFor(traffic()), null);
});

test('highlightedKeysFor marks a restart experiment\'s Deployment target', () => {
  const keys = highlightedKeysFor(restart());
  assert.ok(keys?.has(nodeKey('Deployment', 'ns', 'backend')));
});

test('highlightedKeysFor also marks the most recently transitioned different-named Pod (the replacement), for restart/scale only', () => {
  const withReplacement = restart({
    transitions: [
      { timestamp: 't1', kind: 'Pod', name: 'backend-old', status: 'Terminated', note: '' },
      { timestamp: 't2', kind: 'Pod', name: 'backend-new', status: 'Pending', note: '' },
    ],
  });
  const keys = highlightedKeysFor(withReplacement);
  assert.ok(keys?.has(nodeKey('Pod', 'ns', 'backend-new')));
  assert.ok(!keys?.has(nodeKey('Pod', 'ns', 'backend-old')));
});

test('highlightedKeysFor is null once the experiment is no longer live', () => {
  assert.equal(highlightedKeysFor(restart({ status: 'completed' })), null);
});
