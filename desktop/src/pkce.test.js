const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { generateCodeVerifier, generateCodeChallenge, generateState } = require('./pkce.js');

test('generateCodeVerifier produces a string within RFC 7636\'s 43-128 char length range, URL-safe charset only', () => {
  const verifier = generateCodeVerifier();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `length ${verifier.length} out of range`);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
});

test('generateCodeVerifier is different every call (real randomness, not a fixed value)', () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assert.notEqual(a, b);
});

test('generateCodeChallenge computes the real S256 transform: base64url(SHA256(verifier))', () => {
  const verifier = 'a-fixed-test-verifier-value-for-deterministic-hashing-1234567890';
  const expected = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(generateCodeChallenge(verifier), expected);
});

test('generateState produces a non-empty, URL-safe, non-repeating random string', () => {
  const a = generateState();
  const b = generateState();
  assert.ok(a.length > 0);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test('generateState and generateCodeVerifier never produce the same value (independent randomness sources)', () => {
  assert.notEqual(generateState(), generateCodeVerifier());
});
