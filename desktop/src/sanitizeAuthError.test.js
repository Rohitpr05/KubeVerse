const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuthError } = require('./sanitizeAuthError.js');

test('passes through a clean, short, single-line Error message unchanged', () => {
  assert.equal(sanitizeAuthError(new Error('Google sign-in was cancelled or denied.')), 'Google sign-in was cancelled or denied.');
  assert.equal(sanitizeAuthError(new Error('Sign-in timed out. Please try again.')), 'Sign-in timed out. Please try again.');
});

test('falls back to a generic message for a suspiciously long error message', () => {
  const huge = new Error('x'.repeat(500));
  assert.equal(sanitizeAuthError(huge), 'Google sign-in failed. Please try again.');
});

test('falls back to a generic message for a multi-line error message (e.g. a raw dump slipping through)', () => {
  const multiline = new Error('line one\nline two\nline three: secret-looking-detail');
  assert.equal(sanitizeAuthError(multiline), 'Google sign-in failed. Please try again.');
});

test('handles a non-Error thrown value without throwing itself', () => {
  assert.equal(sanitizeAuthError('a plain string rejection'), 'a plain string rejection');
  // Not an Error, no .message - falls back to String(value); still a clean,
  // short, single-line string, so it passes through rather than being
  // treated as suspicious.
  assert.equal(sanitizeAuthError(undefined), 'undefined');
});
