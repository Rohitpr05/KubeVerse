import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClusterResource, ResourceGraph, TimelineEvent } from '@kubeverse/shared';
import { computeTrafficReadiness } from './trafficReadiness.js';

function service(overrides: Partial<ClusterResource> = {}): ClusterResource {
  return { uid: 'svc-1', kind: 'Service', name: 'frontend', namespace: 'ns', status: 'ClusterIP', labels: {}, annotations: {}, conditions: [], references: [], ...overrides };
}

function pod(overrides: Partial<ClusterResource>): ClusterResource {
  return { uid: 'pod-1', kind: 'Pod', name: 'frontend-abc', namespace: 'ns', status: 'Pending', labels: {}, annotations: {}, conditions: [], references: [], ...overrides };
}

// Builds a ResourceGraph with 'selects' edges from `svc` to each of `pods` -
// the same signal backend/src/routes/lab.ts's resolveReadyTargets uses.
function graphFor(svc: ClusterResource, pods: ClusterResource[]): ResourceGraph {
  return {
    generatedAt: '',
    nodes: [],
    edges: pods.map((p) => ({ id: `selects:${svc.uid}:${p.uid}`, source: svc.uid, target: p.uid, relation: 'selects' })),
  };
}

test('no service selected -> "no-service"', () => {
  const readiness = computeTrafficReadiness(undefined, [], undefined, []);
  assert.equal(readiness.kind, 'no-service');
});

test('a Service with a Ready backing Pod -> "ready", traffic can start', () => {
  const svc = service();
  const readyPod = pod({ status: 'Running (Ready)' });
  const readiness = computeTrafficReadiness(svc, [svc, readyPod], graphFor(svc, [readyPod]), []);
  assert.equal(readiness.kind, 'ready');
  assert.equal(readiness.readyPodCount, 1);
  assert.equal(readiness.totalPodCount, 1);
});

test('a Service with no backing Pods at all -> "no-pods", traffic cannot start', () => {
  const svc = service();
  const readiness = computeTrafficReadiness(svc, [svc], graphFor(svc, []), []);
  assert.equal(readiness.kind, 'no-pods');
  assert.notEqual(readiness.kind, 'ready');
});

test('a Pending Pod with no relevant event -> "pending" with a generic waiting message', () => {
  const svc = service();
  const pendingPod = pod({ status: 'Pending' });
  const readiness = computeTrafficReadiness(svc, [svc, pendingPod], graphFor(svc, [pendingPod]), []);
  assert.equal(readiness.kind, 'pending');
  assert.match(readiness.message, /scheduled/i);
});

test('a Pending Pod with a real FailedScheduling/Insufficient memory event surfaces that reason', () => {
  const svc = service();
  const pendingPod = pod({ status: 'Pending' });
  const events: TimelineEvent[] = [{
    uid: 'ev-1', source: 'kubernetes_event', reason: 'FailedScheduling', involvedName: pendingPod.name, involvedKind: 'Pod', timestamp: '2026-01-01T00:00:00Z',
    message: '0/1 nodes are available: 1 Insufficient memory. no new claims to deallocate, preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.',
  }];
  const readiness = computeTrafficReadiness(svc, [svc, pendingPod], graphFor(svc, [pendingPod]), events);
  assert.equal(readiness.kind, 'pending');
  assert.match(readiness.message, /Insufficient memory/);
  assert.ok(readiness.detail?.includes('Insufficient memory'));
});

test('a Pod that is Running but not yet Ready -> "not-ready" waiting state', () => {
  const svc = service();
  const runningPod = pod({ status: 'Running' });
  const readiness = computeTrafficReadiness(svc, [svc, runningPod], graphFor(svc, [runningPod]), []);
  assert.equal(readiness.kind, 'not-ready');
  assert.notEqual(readiness.kind, 'ready');
});

test('a Running-not-Ready Pod with a real readiness-probe-failed event surfaces that detail', () => {
  const svc = service();
  const runningPod = pod({ status: 'Running' });
  const events: TimelineEvent[] = [{
    uid: 'ev-2', source: 'kubernetes_event', reason: 'Unhealthy', involvedName: runningPod.name, involvedKind: 'Pod', timestamp: '2026-01-01T00:00:00Z',
    message: 'Readiness probe failed: Get "http://10.244.0.5:8080/": dial tcp 10.244.0.5:8080: connect: connection refused',
  }];
  const readiness = computeTrafficReadiness(svc, [svc, runningPod], graphFor(svc, [runningPod]), events);
  assert.equal(readiness.kind, 'not-ready');
  assert.match(readiness.message, /readiness probe failed/i);
});

test('a Pod in CrashLoopBackOff -> "failing" with the real container status surfaced', () => {
  const svc = service();
  const crashingPod = pod({ status: 'Running', containers: [{ name: 'app', status: 'CrashLoopBackOff', restartCount: 4 }] });
  const readiness = computeTrafficReadiness(svc, [svc, crashingPod], graphFor(svc, [crashingPod]), []);
  assert.equal(readiness.kind, 'failing');
  assert.match(readiness.message, /CrashLoopBackOff/);
  assert.ok(readiness.message.includes(crashingPod.name));
});

test('a Pod in ImagePullBackOff -> "failing" (not confused with a scheduling/pending wait)', () => {
  const svc = service();
  const badImagePod = pod({ status: 'Pending', containers: [{ name: 'app', status: 'ImagePullBackOff', restartCount: 0 }] });
  const readiness = computeTrafficReadiness(svc, [svc, badImagePod], graphFor(svc, [badImagePod]), []);
  assert.equal(readiness.kind, 'failing');
  assert.match(readiness.message, /ImagePullBackOff/);
});

test('unrelated services/Pods elsewhere in the project are ignored - only the selected Service\'s own selected Pods count', () => {
  const target = service({ uid: 'svc-target', name: 'frontend' });
  const other = service({ uid: 'svc-other', name: 'backend' });
  const targetPod = pod({ uid: 'pod-target', name: 'frontend-abc', status: 'Running (Ready)' });
  const otherFailingPod = pod({ uid: 'pod-other', name: 'backend-xyz', status: 'Running', containers: [{ name: 'app', status: 'CrashLoopBackOff', restartCount: 9 }] });

  const graph: ResourceGraph = {
    generatedAt: '', nodes: [],
    edges: [
      { id: 'e1', source: target.uid, target: targetPod.uid, relation: 'selects' },
      { id: 'e2', source: other.uid, target: otherFailingPod.uid, relation: 'selects' },
    ],
  };
  const resources = [target, other, targetPod, otherFailingPod];
  const readiness = computeTrafficReadiness(target, resources, graph, []);
  assert.equal(readiness.kind, 'ready', 'the unrelated failing Pod under a different Service must not affect this Service\'s readiness');
});

test('a Service uid absent from the graph entirely (e.g. stale selection after a project switch) is never reported ready', () => {
  const staleService = service({ uid: 'svc-from-another-project' });
  const readiness = computeTrafficReadiness(staleService, [], { generatedAt: '', nodes: [], edges: [] }, []);
  assert.notEqual(readiness.kind, 'ready');
  assert.equal(readiness.kind, 'no-pods');
});

test('failing takes priority over pending when Pods are in mixed states', () => {
  const svc = service();
  const pendingPod = pod({ uid: 'pod-pending', name: 'frontend-a', status: 'Pending' });
  const crashingPod = pod({ uid: 'pod-crash', name: 'frontend-b', status: 'Running', containers: [{ name: 'app', status: 'CrashLoopBackOff', restartCount: 3 }] });
  const readiness = computeTrafficReadiness(svc, [svc, pendingPod, crashingPod], graphFor(svc, [pendingPod, crashingPod]), []);
  assert.equal(readiness.kind, 'failing');
});

test('one Ready Pod among several not-yet-ready ones is enough to allow traffic, and readyPodCount reflects only the Ready ones', () => {
  const svc = service();
  const readyPod = pod({ uid: 'pod-ready', name: 'frontend-a', status: 'Running (Ready)' });
  const startingPod = pod({ uid: 'pod-starting', name: 'frontend-b', status: 'Pending' });
  const readiness = computeTrafficReadiness(svc, [svc, readyPod, startingPod], graphFor(svc, [readyPod, startingPod]), []);
  assert.equal(readiness.kind, 'ready');
  assert.equal(readiness.readyPodCount, 1);
  assert.equal(readiness.totalPodCount, 2);
});

// Live transition (UX refinement, Part 5): computeTrafficReadiness is a pure
// function of its arguments with no internal memory, so calling it again
// with the Pod's updated status - exactly what a real 'cluster-update' SSE
// event drives in PlaygroundView - transitions the result with no polling
// and no reset needed.
test('a Pod transitioning Pending -> Ready across two calls flips the result from not-startable to "ready"', () => {
  const svc = service();
  const pendingPod = pod({ status: 'Pending' });
  const before = computeTrafficReadiness(svc, [svc, pendingPod], graphFor(svc, [pendingPod]), []);
  assert.notEqual(before.kind, 'ready');

  const nowReadyPod = { ...pendingPod, status: 'Running (Ready)' };
  const after = computeTrafficReadiness(svc, [svc, nowReadyPod], graphFor(svc, [nowReadyPod]), []);
  assert.equal(after.kind, 'ready');
});
