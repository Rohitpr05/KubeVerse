import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./views/SettingsView.tsx', import.meta.url)), 'utf8');

// Regression test: Settings' "Local environment" card used to render
// environment.docker.error / environment.kubernetes.error verbatim -
// checkDockerAvailable()/checkKubectlAvailable()'s own raw execFile catch
// message (backend/src/execution/dockerRunner.ts,
// backend/src/execution/kubernetesRunner.ts), which includes the full
// attempted CLI command and, on a real machine, the Docker socket's actual
// filesystem path - an implementation detail no normal user needs to see.
// This repo has no React-render-testing setup (no @testing-library/react/
// jsdom - see frontend/package.json), so - matching trafficLayering.test.ts's
// own established pattern - this asserts against the real component source
// directly rather than a rendered DOM.
//
// The real availability check itself is unchanged (still real
// child_process calls, still a genuine `available: boolean`, per
// backend/src/execution/dockerRunner.ts and kubernetesRunner.ts, which this
// file does not touch) - only the two lines that render `.error` to the
// user were fixed, so this deliberately does NOT touch/mock the backend.
test('the Docker "unreachable" message is a clean, friendly sentence - never environment.docker.error interpolated', () => {
  assert.doesNotMatch(source, /environment\.docker\.error/, 'the raw Docker execFile error must never reach the rendered UI text');
  assert.match(source, /your Docker is currently unreachable — start or enable Docker and recheck/);
});

test('the kubectl "unavailable" message is a clean, friendly sentence - never environment.kubernetes.error interpolated', () => {
  assert.doesNotMatch(source, /environment\.kubernetes\.error/, 'the raw kubectl execFile error must never reach the rendered UI text');
  assert.match(source, /kubectl is currently unavailable — install kubectl or configure a cluster context and recheck/);
});

// The Docker/kubectl status BADGE (the "Unavailable"/"Missing" label itself,
// driven directly by the real environment.docker.available /
// environment.kubernetes.available booleans) must still reflect the real
// check - the fix only changes the human-readable detail text next to it,
// never fabricates a fake "healthy" status.
test('Docker/kubectl status badges still reflect the real environment.*.available booleans, unchanged', () => {
  assert.match(source, /environment\?\.docker\.available \? 'status-badge ok' : 'status-badge error'/);
  assert.match(source, /environment\?\.kubernetes\.available \? 'status-badge ok' : 'status-badge error'/);
  assert.match(source, /environment\.docker\.available \? 'Available' : 'Unavailable'/);
});

// The existing, already-clean Kubernetes (cluster connectivity) row must be
// untouched - it never exposed a raw error and didn't need this fix.
test('the already-clean Kubernetes connectivity row is untouched', () => {
  assert.match(source, /your cluster is currently unreachable — start or enable Kubernetes and recheck/);
});
