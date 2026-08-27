import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClusterState } from './cluster-state.js';
import { KubernetesObserver } from './kubernetes-observer.js';

// Regression test for a real production incident: `npm run dev` failed with
// "ECONNREFUSED 127.0.0.1:4000" on every request because the backend process
// was crashing at startup, before ever calling app.listen(). Root cause:
// KubernetesObserver used to build its Kubernetes API clients
// (k8s.KubeConfig#makeApiClient) in its CONSTRUCTOR, which server.ts calls
// unguarded (`const observer = new KubernetesObserver(...)`, no try/catch) -
// only observer.start() was ever wrapped in a try/catch. makeApiClient
// throws synchronously ("No active cluster!") the moment the local
// kubeconfig has no current context, which is an entirely ordinary local
// state (Docker Desktop's Kubernetes not running, or having just crashed) -
// not something that should ever be able to take down the whole backend.

test('constructing a KubernetesObserver never throws, regardless of local Kubernetes configuration', () => {
  const state = new ClusterState(() => {});
  assert.doesNotThrow(() => new KubernetesObserver(state, []));
});

test('start() resolves and records an observer error - it never rejects/throws - when the local kubeconfig has no active cluster', async (t) => {
  // A minimal, valid-YAML kubeconfig with no clusters/contexts reproduces
  // the exact "No active cluster!" failure deterministically, regardless of
  // whatever kubeconfig actually exists on the machine running this test.
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-empty-kubeconfig-'));
  const emptyKubeconfigPath = join(dir, 'config');
  writeFileSync(emptyKubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');

  const previousKubeconfig = process.env.KUBECONFIG;
  process.env.KUBECONFIG = emptyKubeconfigPath;
  t.after(() => {
    if (previousKubeconfig === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previousKubeconfig;
  });

  const state = new ClusterState(() => {});
  const observer = new KubernetesObserver(state, []);
  await assert.doesNotReject(() => observer.start());

  const errors = state.snapshot().observerErrors;
  assert.ok(
    errors.some((message) => message.includes('Kubernetes configuration unavailable')),
    `expected a recorded "Kubernetes configuration unavailable" error, got: ${JSON.stringify(errors)}`,
  );
});

// Regression test for the follow-up bug found via real-cluster verification:
// fixing the crash (above) was not enough on its own. start() used to be a
// one-shot latch (`if (this.started) return`) - once the *first* connection
// attempt failed, nothing ever tried again, so a real Docker Desktop
// Kubernetes cluster that became reachable seconds later (confirmed live:
// `kubectl config current-context` -> docker-desktop, `kubectl get nodes` ->
// Ready) was never picked up - the Playground stayed stuck showing "No
// active cluster!" for the rest of the process's life. connect() now
// reschedules itself on failure (see RECONNECT_INTERVAL_MS) instead of
// giving up permanently.
//
// This intentionally never lets the kubeconfig become valid, so the
// observer's fully-successful path (which starts real Kubernetes watches)
// is never reached - keeping this test fast, deterministic, and free of any
// dependency on a real reachable cluster.
test('after an initial connection failure, the observer keeps retrying in the background instead of giving up permanently', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-empty-kubeconfig-retry-'));
  const emptyKubeconfigPath = join(dir, 'config');
  writeFileSync(emptyKubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');

  const previousKubeconfig = process.env.KUBECONFIG;
  process.env.KUBECONFIG = emptyKubeconfigPath;
  t.after(() => {
    if (previousKubeconfig === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previousKubeconfig;
  });

  const state = new ClusterState(() => {});
  const recordError = t.mock.method(state, 'recordError');

  const observer = new KubernetesObserver(state, []);
  await observer.start();
  assert.equal(recordError.mock.callCount(), 1, 'the first failed attempt records exactly one error');

  // RECONNECT_INTERVAL_MS is 1000ms - wait past it so the backgrounded retry
  // this class schedules on failure has a chance to fire (and fail again,
  // since the kubeconfig is still empty) at least once more.
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.ok(
    recordError.mock.callCount() >= 2,
    `expected at least 2 connection attempts (proving it retried instead of giving up), got ${recordError.mock.callCount()}`,
  );
});
