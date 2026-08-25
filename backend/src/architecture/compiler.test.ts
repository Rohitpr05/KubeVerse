import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileArchitecture } from './compiler.js';
import type { AiProvider } from './providers/types.js';

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
