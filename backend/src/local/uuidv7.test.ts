import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuidv7, uuidv7 } from './uuidv7.js';

test('uuidv7 produces a well-formed, RFC 9562 compliant identifier', () => {
  const id = uuidv7();
  assert.equal(isUuidv7(id), true);
  assert.equal(id.length, 36);
});

function timestampMs(id: string): number {
  // The 48-bit ms timestamp occupies the first two hyphen-separated groups.
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

test('uuidv7 embeds a non-decreasing millisecond timestamp', async () => {
  const first = uuidv7();
  await new Promise((done) => setTimeout(done, 2));
  const second = uuidv7();
  assert.ok(timestampMs(second) >= timestampMs(first));
});

test('uuidv7 generates unique values', () => {
  const values = new Set(Array.from({ length: 1000 }, () => uuidv7()));
  assert.equal(values.size, 1000);
});
