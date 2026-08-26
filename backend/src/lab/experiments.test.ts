import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterState } from '../cluster-state.js';
import { MANAGED_BY_LABEL, MANAGED_BY_VALUE, PROJECT_ID_LABEL } from '../ownership.js';
import { ExperimentTracker } from './experiments.js';

const PROJECT_A = 'project-a';

function withOwnership(labels: Record<string, string> = {}): Record<string, string> {
  return { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE, [PROJECT_ID_LABEL]: PROJECT_A, ...labels };
}

// Builds a ClusterState with a realistic Deployment -> ReplicaSet -> Pod
// ownership chain, the same shape the real observer produces - covers the
// generic convergence rule experiments.ts relies on for pod-failure/restart/
// scale alike (see experiments.ts's module doc comment).
function buildFixture() {
  const state = new ClusterState(() => {});
  state.replace('Namespace', [{ metadata: { uid: 'ns', name: 'shop', labels: withOwnership() }, status: { phase: 'Active' } }]);
  state.replace('Deployment', [{
    metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) },
    spec: { replicas: 1 }, status: { replicas: 1, readyReplicas: 1 },
  }]);
  state.replace('ReplicaSet', [{
    metadata: { uid: 'rs-1', name: 'backend-abc', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'dep-1', kind: 'Deployment', name: 'backend', controller: true }] },
    spec: { replicas: 1 }, status: { replicas: 1, readyReplicas: 1 },
  }]);
  state.replace('Pod', [{
    metadata: { uid: 'pod-1', name: 'backend-abc-111', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', controller: true }] },
    spec: { containers: [{ name: 'backend' }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
  }]);
  return state;
}

test('start() seeds the tracked set with the target\'s full owner chain (Pod -> ReplicaSet -> Deployment)', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');
  assert.equal(experiment.status, 'preparing');
  assert.equal(experiment.target.name, 'backend-abc-111');

  // A MODIFIED update on the Deployment itself (owner-chain root) must be
  // recognized as relevant even though the experiment was started against
  // the Pod, three hops down.
  state.apply('Deployment', 'MODIFIED', {
    metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) },
    spec: { replicas: 1 }, status: { replicas: 0, readyReplicas: 0 },
  });
  const updated = tracker.get(PROJECT_A, experiment.id)!;
  assert.ok(updated.transitions.some((transition) => transition.kind === 'Deployment'), 'a transition on the owner-chain root must be recorded');
});

test('a replacement Pod created by the tracked ReplicaSet is picked up dynamically, and convergence completes the experiment', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');

  // The original Pod is terminated.
  state.apply('Pod', 'DELETED', {
    metadata: { uid: 'pod-1', name: 'backend-abc-111', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', controller: true }] },
  });
  // The Deployment briefly reports the shortage.
  state.apply('Deployment', 'MODIFIED', {
    metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) },
    spec: { replicas: 1 }, status: { replicas: 0, readyReplicas: 0 },
  });
  // A brand-new Pod, never seen before, owned by the SAME tracked ReplicaSet -
  // this is "the replacement", detected purely by owner.uid membership.
  state.apply('Pod', 'ADDED', {
    metadata: { uid: 'pod-2', name: 'backend-abc-222', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', controller: true }] },
    spec: { containers: [{ name: 'backend' }] }, status: { phase: 'Pending' },
  });

  let mid = tracker.get(PROJECT_A, experiment.id)!;
  assert.equal(mid.status, 'running');
  assert.ok(mid.transitions.some((transition) => transition.name === 'backend-abc-222' && transition.status === 'Pending'), 'the replacement Pod\'s own transitions must be tracked, not just the original Pod\'s');

  // The Deployment converges: ready === current === desired again.
  state.apply('Deployment', 'MODIFIED', {
    metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) },
    spec: { replicas: 1 }, status: { replicas: 1, readyReplicas: 1 },
  });

  const finished = tracker.get(PROJECT_A, experiment.id)!;
  assert.equal(finished.status, 'completed');
  assert.ok(finished.endedAt);
});

test('an update to an unrelated resource never appears in the experiment\'s transitions', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');

  state.replace('Deployment', [
    { metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) }, spec: { replicas: 1 }, status: { replicas: 1, readyReplicas: 1 } },
    { metadata: { uid: 'dep-unrelated', name: 'frontend', namespace: 'shop', labels: withOwnership({ app: 'frontend' }) }, spec: { replicas: 1 }, status: { replicas: 0, readyReplicas: 0 } },
  ]);
  state.apply('Deployment', 'MODIFIED', { metadata: { uid: 'dep-unrelated', name: 'frontend', namespace: 'shop', labels: withOwnership({ app: 'frontend' }) }, spec: { replicas: 1 }, status: { replicas: 0, readyReplicas: 0 } });

  const result = tracker.get(PROJECT_A, experiment.id)!;
  assert.ok(!result.transitions.some((transition) => transition.name === 'frontend'), 'an unrelated Deployment must never show up in this experiment\'s transitions');
});

test('repeated identical status updates are deduplicated, not appended as duplicate transitions', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');

  const rawPod = { metadata: { uid: 'pod-1', name: 'backend-abc-111', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', controller: true }] }, spec: { containers: [{ name: 'backend' }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } };
  state.apply('Pod', 'MODIFIED', rawPod);
  state.apply('Pod', 'MODIFIED', rawPod);
  state.apply('Pod', 'MODIFIED', rawPod);

  const result = tracker.get(PROJECT_A, experiment.id)!;
  const podTransitions = result.transitions.filter((transition) => transition.name === 'backend-abc-111');
  assert.equal(podTransitions.length, 1, 'three identical MODIFIED updates for the same status must collapse into one transition');
});

test('a Pod status transition carries a short human-readable explanation', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');

  state.apply('Pod', 'ADDED', {
    metadata: { uid: 'pod-2', name: 'backend-abc-222', namespace: 'shop', labels: withOwnership({ app: 'backend' }), ownerReferences: [{ uid: 'rs-1', kind: 'ReplicaSet', name: 'backend-abc', controller: true }] },
    spec: { containers: [{ name: 'backend' }] }, status: { phase: 'Pending' },
  });

  const result = tracker.get(PROJECT_A, experiment.id)!;
  const pending = result.transitions.find((transition) => transition.name === 'backend-abc-222');
  assert.match(pending!.explanation ?? '', /has not finished scheduling/i);
});

test('cancel() marks the experiment cancelled and stops further tracking', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const experiment = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod backend-abc-111');
  tracker.cancel(experiment.id);

  const cancelled = tracker.get(PROJECT_A, experiment.id)!;
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.endedAt);

  const transitionCountBefore = cancelled.transitions.length;
  state.apply('Deployment', 'MODIFIED', { metadata: { uid: 'dep-1', name: 'backend', namespace: 'shop', labels: withOwnership({ app: 'backend' }) }, spec: { replicas: 1 }, status: { replicas: 0, readyReplicas: 0 } });
  const afterCancel = tracker.get(PROJECT_A, experiment.id)!;
  assert.equal(afterCancel.transitions.length, transitionCountBefore, 'a cancelled experiment must not keep accumulating transitions');
});

test('list() returns experiments most-recent-first and scoped to the requesting project only', () => {
  const state = buildFixture();
  const tracker = new ExperimentTracker(state);
  const pod = state.resourceByUid('pod-1')!;
  const first = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod one');
  const second = tracker.start(PROJECT_A, 'pod-failure', pod, 'Fail Pod two');
  tracker.start('project-b', 'pod-failure', pod, 'Unrelated project experiment');

  const list = tracker.list(PROJECT_A);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id, 'most recently started experiment must come first');
  assert.equal(list[1].id, first.id);
  assert.ok(list.every((experiment) => experiment.projectId === PROJECT_A));
});
