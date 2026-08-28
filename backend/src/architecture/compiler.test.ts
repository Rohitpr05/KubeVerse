import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileArchitecture } from './compiler.js';
import { DEFAULT_OPENROUTER_MODEL } from '../local/settings.js';
import type { AiProvider, CompileOptions } from './providers/types.js';

// No live OpenRouter key exists in this environment, so these tests exercise
// the compile pipeline (parse -> validate) against a stubbed provider rather
// than a real network call. The provider adapter itself is not covered here.
function stubProvider(raw: string): AiProvider {
  return {
    id: 'stub',
    async compileArchitecture() {
      return raw;
    },
    async validateCredential() {
      return { valid: true };
    },
  };
}

const request = { providerId: 'stub', model: 'test-model', apiKey: 'test-key' };

test('accepts a valid JSON proposal from the provider', async () => {
  const provider = stubProvider(
    JSON.stringify({
      name: 'shop',
      services: [{ name: 'api', type: 'backend', runtime: 'node', port: 4000 }],
    }),
  );
  const outcome = await compileArchitecture('Backend: Node.js, port 4000', request, provider);
  assert.equal(outcome.success, true);
});

test('strips markdown code fences before parsing', async () => {
  const provider = stubProvider('```json\n{"name":"shop","services":[{"name":"api","type":"backend","runtime":"node","port":4000}]}\n```');
  const outcome = await compileArchitecture('Backend: Node.js, port 4000', request, provider);
  assert.equal(outcome.success, true);
});

test('rejects malformed JSON from the provider', async () => {
  const provider = stubProvider('not json');
  const outcome = await compileArchitecture('Backend', request, provider);
  assert.equal(outcome.success, false);
});

test('rejects JSON that fails schema validation', async () => {
  const provider = stubProvider(JSON.stringify({ name: 'shop', services: [] }));
  const outcome = await compileArchitecture('Backend', request, provider);
  assert.equal(outcome.success, false);
});

// --- model resolution: "the backend is the final safety net" ---
// Regression coverage for the real reported bug: OpenRouter rejecting a
// request with HTTP 400 "No models provided" because an empty "model" field
// reached the provider request. These prove compileArchitecture() itself -
// not just local/settings.ts's own read/write path - can never hand the
// provider an unusable model, by capturing exactly what CompileOptions the
// provider actually receives.

function capturingProvider(): { provider: AiProvider; captured: CompileOptions[] } {
  const captured: CompileOptions[] = [];
  const provider: AiProvider = {
    id: 'stub',
    async compileArchitecture(_source, options) {
      captured.push(options);
      return JSON.stringify({ name: 'shop', services: [{ name: 'api', type: 'backend', runtime: 'node', port: 4000 }] });
    },
    async validateCredential() {
      return { valid: true };
    },
  };
  return { provider, captured };
}

test('a real configured model is sent to the provider unchanged', async () => {
  const { provider, captured } = capturingProvider();
  await compileArchitecture('Backend: Node.js, port 4000', { providerId: 'stub', model: 'anthropic/claude-3.5-sonnet', apiKey: 'test-key' }, provider);
  assert.equal(captured[0]?.model, 'anthropic/claude-3.5-sonnet');
});

test('an empty-string model resolves to DEFAULT_OPENROUTER_MODEL before reaching the provider - never sent as ""', async () => {
  const { provider, captured } = capturingProvider();
  await compileArchitecture('Backend: Node.js, port 4000', { providerId: 'stub', model: '', apiKey: 'test-key' }, provider);
  assert.equal(captured[0]?.model, DEFAULT_OPENROUTER_MODEL);
  assert.notEqual(captured[0]?.model, '');
});

test('a whitespace-only model also resolves to the default, not to whitespace', async () => {
  const { provider, captured } = capturingProvider();
  await compileArchitecture('Backend: Node.js, port 4000', { providerId: 'stub', model: '   ', apiKey: 'test-key' }, provider);
  assert.equal(captured[0]?.model, DEFAULT_OPENROUTER_MODEL);
});

// Simulates "old settings/old projects with no model field at all" - the
// CompileRequest type requires `model: string`, but a caller reading from a
// legacy on-disk JSON blob (cast through `as`, or a future second call site)
// could still hand this `undefined` at runtime.
test('a missing (undefined) model resolves to the default, simulating a legacy settings object', async () => {
  const { provider, captured } = capturingProvider();
  const legacyRequest = { providerId: 'stub', apiKey: 'test-key' } as unknown as { providerId: string; model: string; apiKey: string };
  await compileArchitecture('Backend: Node.js, port 4000', legacyRequest, provider);
  assert.equal(captured[0]?.model, DEFAULT_OPENROUTER_MODEL);
});

test('rejects an empty source without calling the provider', async () => {
  let called = false;
  const provider: AiProvider = {
    id: 'stub',
    async compileArchitecture() {
      called = true;
      return '{}';
    },
    async validateCredential() {
      return { valid: true };
    },
  };
  const outcome = await compileArchitecture('   ', request, provider);
  assert.equal(outcome.success, false);
  assert.equal(called, false);
});
