const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeUpdateError, describeErrorForLog, createSanitizedUpdaterLogger } = require('./sanitizeUpdateError.js');

// Reproduces builder-util-runtime's real HttpError class shape exactly
// (httpExecutor.js's createHttpError/HttpError - see sanitizeUpdateError.js's
// own comment): a real GitHub 404 response's Set-Cookie header, structurally
// identical to what was actually observed live in this terminal before the
// fix (session cookies included), baked into .message the same way
// createHttpError() really builds it.
function realShapedHttpError({ statusCode = 404, url = 'https://github.com/Rohitpr05/KubeVerse/releases.atom' } = {}) {
  const headers = {
    'cache-control': 'no-cache',
    'content-type': 'text/plain; charset=utf-8',
    'x-github-request-id': 'C520:2E670B:10CE2FB:11E1287:6A905F32',
    'set-cookie': [
      '_gh_sess=hF7E7iHay0EN%2BiMKz3RoJjmBz%2Fra4ih1zBy%2BwEpp9diIocfp5qja0uHXbottGf2xIYvtpsF%3D; path=/; HttpOnly; secure; SameSite=Lax',
      '_octo=GH1.1.1490457957.1787846450; expires=Fri, 27 Aug 2027 16:00:50 GMT; domain=.github.com; path=/; secure; SameSite=Lax',
      'logged_in=no; expires=Fri, 27 Aug 2027 16:00:50 GMT; domain=.github.com; path=/; HttpOnly; secure; SameSite=Lax',
    ],
  };
  const description = `method: GET url: ${url}\n\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\n`;
  const message = `${statusCode} Not Found\n${JSON.stringify(description, null, '  ')}\nHeaders: ${JSON.stringify(headers)}`;
  const error = new Error(message);
  error.name = 'HttpError';
  error.statusCode = statusCode;
  error.code = `HTTP_ERROR_${statusCode}`;
  error.description = description;
  return error;
}

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

// --- describeErrorForLog: what the main process's own console is allowed
// to see - regression coverage for the real leak (console.error(msg, error)
// printing the raw error, whose .stack starts with .message) ---

test('describeErrorForLog reduces a real-shaped GitHub HttpError to just "HTTP <status>"', () => {
  const error = realShapedHttpError({ statusCode: 404 });
  assert.equal(describeErrorForLog(error), 'HTTP 404');
});

// The actual regression: every sensitive/identifying string that was really
// observed leaking into this terminal must be provably absent from the log
// line, not just "probably fine".
test('cookies, request IDs, URLs, and header names never appear in the log line, for any statusCode', () => {
  for (const statusCode of [400, 401, 403, 404, 429, 500, 503]) {
    const line = describeErrorForLog(realShapedHttpError({ statusCode }));
    for (const forbidden of ['_gh_sess', '_octo', 'logged_in', 'Set-Cookie', 'set-cookie', 'Authorization', 'Cookie', 'x-github-request-id', 'github.com', 'HttpOnly', 'SameSite']) {
      assert.doesNotMatch(line, new RegExp(forbidden, 'i'), `describeErrorForLog(${statusCode}) leaked "${forbidden}": ${line}`);
    }
  }
});

test('describeErrorForLog never includes .message, .stack, .description, or .headers content - only statusCode/code/name', () => {
  const error = realShapedHttpError({ statusCode: 404 });
  const line = describeErrorForLog(error);
  // The line must be short and exactly what a human would want in a log,
  // never anything derived from the free-text fields.
  assert.ok(line.length < 30, `expected a short structured summary, got: ${line}`);
  assert.equal(line, 'HTTP 404');
});

test('describeErrorForLog falls back to error.code for a non-HTTP error (e.g. genuinely offline)', () => {
  const offline = new Error('getaddrinfo ENOTFOUND api.github.com');
  offline.code = 'ENOTFOUND';
  assert.equal(describeErrorForLog(offline), 'ENOTFOUND');
});

test('describeErrorForLog falls back to error.name when neither statusCode nor code is present', () => {
  const plain = new Error('something went wrong internally, with a possibly-unsafe detail: secret=abc123');
  plain.name = 'InternalError';
  const line = describeErrorForLog(plain);
  assert.equal(line, 'InternalError');
  assert.doesNotMatch(line, /secret/);
});

test('describeErrorForLog handles a non-object thrown value without throwing itself', () => {
  assert.equal(describeErrorForLog('a plain string rejection'), 'unknown error');
  assert.equal(describeErrorForLog(undefined), 'unknown error');
  assert.equal(describeErrorForLog(null), 'unknown error');
});

// --- createSanitizedUpdaterLogger: the real, deeper fix ---
//
// Regression test for a real leak, confirmed live on the actual packaged
// app: electron-updater's AppUpdater constructor always registers its own
// internal 'error' listener (`this.on("error", (error) => { this._logger
// .error(\`Error: ${error.stack || error.message}\`); })`), completely
// independent of updater.js's own listener. With the default logger
// (`this._logger = console`), that means electron-updater's own internals
// print the exact raw HTTP/cookie dump this whole module exists to
// suppress, *regardless* of updater.js's own already-sanitized
// console.error call - the two are separate listeners on the same event.
// autoUpdater.logger = createSanitizedUpdaterLogger() is the fix; these
// tests exercise the logger object in isolation, exactly as electron-updater
// itself calls it (a pre-formatted string, never the original error object).

test('the sanitized logger\'s error() never prints anything, for any string it is given - including a raw header/cookie dump', () => {
  const printed = [];
  const fakeBase = { info: (m) => printed.push(['info', m]), warn: (m) => printed.push(['warn', m]), error: (m) => printed.push(['error', m]) };
  const logger = createSanitizedUpdaterLogger(fakeBase);

  const rawDump = 'Error: HttpError: 404 \nHeaders: {"set-cookie":["_gh_sess=abc123; HttpOnly","_octo=def456"]}\n    at createHttpError (.../httpExecutor.js:53:12)';
  logger.error(rawDump);

  assert.deepEqual(printed, [], 'error() must never reach the base logger, for any input');
});

test('the sanitized logger\'s warn() also never prints anything (electron-updater interpolates raw errors into warn() too)', () => {
  const printed = [];
  const fakeBase = { info: (m) => printed.push(m), warn: (m) => printed.push(m), error: (m) => printed.push(m) };
  const logger = createSanitizedUpdaterLogger(fakeBase);

  logger.warn('Cannot download differentially, fallback to full download: HttpError: 404 Headers: {"set-cookie":["_gh_sess=leak"]}');

  assert.deepEqual(printed, []);
});

test('the sanitized logger\'s info() passes safe operational messages straight through', () => {
  const printed = [];
  const fakeBase = { info: (m) => printed.push(m), warn: () => {}, error: () => {} };
  const logger = createSanitizedUpdaterLogger(fakeBase);

  logger.info('Checking for update');
  logger.info('Found version 3.1.0 (url: https://github.com/Rohitpr05/KubeVerse/releases/download/v3.1.0/KubeVerse-3.1.0-linux-x86_64.AppImage)');

  assert.deepEqual(printed, [
    'Checking for update',
    'Found version 3.1.0 (url: https://github.com/Rohitpr05/KubeVerse/releases/download/v3.1.0/KubeVerse-3.1.0-linux-x86_64.AppImage)',
  ]);
});

test('createSanitizedUpdaterLogger defaults to the real console when no base logger is injected', () => {
  const logger = createSanitizedUpdaterLogger();
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.doesNotThrow(() => logger.warn('anything'));
  assert.doesNotThrow(() => logger.error('anything'));
});
