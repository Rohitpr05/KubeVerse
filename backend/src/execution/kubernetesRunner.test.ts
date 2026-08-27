import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression test for the same production incident kubernetes-observer.test.ts
// documents ("ECONNREFUSED 127.0.0.1:4000" - the backend crashing at
// startup). This module was actually the FIRST thing to crash in the
// captured stack trace: it used to build a k8s.KubernetesObjectApi client at
// module TOP LEVEL (`const objectApi = k8s.KubernetesObjectApi.makeApiClient(...)`),
// which throws synchronously ("No active cluster!") the moment the local
// kubeconfig has no current context - and since it happens during module
// evaluation (import time), it crashed the whole process before server.ts's
// own code, or any try/catch, ever ran. Mutations now build a fresh client
// per call instead (see freshObjectApi()/freshKubeConfig()), so merely
// importing this module must never touch Kubernetes configuration at all.
test('importing kubernetesRunner.js never throws, even when the local kubeconfig has no active cluster', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-empty-kubeconfig-runner-'));
  const emptyKubeconfigPath = join(dir, 'config');
  writeFileSync(emptyKubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');

  const previousKubeconfig = process.env.KUBECONFIG;
  process.env.KUBECONFIG = emptyKubeconfigPath;
  t.after(() => {
    if (previousKubeconfig === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previousKubeconfig;
  });

  await assert.doesNotReject(() => import('./kubernetesRunner.js'));
});

test('a Kubernetes mutation attempted with no active cluster fails gracefully (ok:false), it does not throw', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-empty-kubeconfig-runner-mutate-'));
  const emptyKubeconfigPath = join(dir, 'config');
  writeFileSync(emptyKubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');

  const previousKubeconfig = process.env.KUBECONFIG;
  process.env.KUBECONFIG = emptyKubeconfigPath;
  t.after(() => {
    if (previousKubeconfig === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previousKubeconfig;
  });

  const { deletePod } = await import('./kubernetesRunner.js');
  const result = await deletePod('default', 'nonexistent-pod');
  assert.equal(result.ok, false);
  assert.match(result.output, /No active cluster/);
});
