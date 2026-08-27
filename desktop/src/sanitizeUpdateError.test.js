const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeUpdateError } = require('./sanitizeUpdateError.js');

// Regression test for a real bug: Settings used to render electron-updater's
// raw error.message directly - for a real GitHub 404 (no release published
// yet) this is a multi-line dump of HTTP status/headers/response body, not
// something a user should ever see. Every real failure shape must reduce to
// the same clean, generic sentence.
test('a raw HTTP-response-shaped error message is never surfaced verbatim', () => {
  const rawGithub404 = new Error(
    'HttpError: 404\n' +
    'url: "https://api.github.com/repos/Rohitpr05/KubeVerse/releases/latest"\n' +
    'headers: {"content-type":"application/json; charset=utf-8","x-ratelimit-limit":"60"}\n' +
    'body: {"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
  );
  const message = sanitizeUpdateError(rawGithub404);
  assert.equal(message, "Couldn't check for updates right now.");
  assert.doesNotMatch(message, /api\.github\.com/);
  assert.doesNotMatch(message, /headers/i);
  assert.doesNotMatch(message, /content-type/i);
  assert.doesNotMatch(message, /404/);
});

test('a generic network error also reduces to the same clean sentence', () => {
  assert.equal(sanitizeUpdateError(new Error('getaddrinfo ENOTFOUND api.github.com')), "Couldn't check for updates right now.");
});

test('a non-Error thrown value (e.g. a raw string) does not throw while sanitizing', () => {
  assert.equal(sanitizeUpdateError('some raw rejection reason'), "Couldn't check for updates right now.");
  assert.equal(sanitizeUpdateError(undefined), "Couldn't check for updates right now.");
});
