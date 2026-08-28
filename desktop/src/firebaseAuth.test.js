const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { exchangeGoogleIdTokenForFirebaseSession, refreshFirebaseSession } = require('./firebaseAuth.js');

// A fake local "Firebase" server - not a mock of this module's own
// functions, a real HTTP server this module's real fetch() calls actually
// talk to, exactly like googleAuth.test.js's fake "Google" server. Only
// real Google/Firebase credentials this environment doesn't have are
// avoided; every other real code path (URL construction, request body
// shape, response parsing, error handling) is genuinely exercised.
function startFakeServer(respond) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => respond(req, body, res));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('exchangeGoogleIdTokenForFirebaseSession sends the real Google ID token as the correct postBody shape and API key as a query param', async () => {
  let capturedUrl;
  let capturedBody;
  const { server, port } = await startFakeServer((req, rawBody, res) => {
    capturedUrl = req.url;
    capturedBody = JSON.parse(rawBody);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      localId: 'firebase-uid-123',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      photoUrl: 'https://example.com/a.jpg',
      idToken: 'firebase-id-token',
      refreshToken: 'firebase-refresh-token',
    }));
  });
  try {
    const result = await exchangeGoogleIdTokenForFirebaseSession({
      googleIdToken: 'real-google-id-token',
      apiKey: 'fake-firebase-web-api-key',
      signInEndpoint: `http://127.0.0.1:${port}`,
    });

    assert.match(capturedUrl, /key=fake-firebase-web-api-key/);
    assert.equal(capturedBody.postBody, 'id_token=real-google-id-token&providerId=google.com');
    assert.equal(capturedBody.returnSecureToken, true);
    assert.equal(capturedBody.requestUri, 'http://localhost');

    assert.deepEqual(result.identity, { uid: 'firebase-uid-123', email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' });
    assert.equal(result.idToken, 'firebase-id-token');
    assert.equal(result.refreshToken, 'firebase-refresh-token');
  } finally {
    server.close();
  }
});

test('the Firebase UID (localId), not email, is the identity - proven by using it even when email is absent', async () => {
  const { server, port } = await startFakeServer((_req, _body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ localId: 'firebase-uid-no-email', idToken: 't', refreshToken: 'r' }));
  });
  try {
    const result = await exchangeGoogleIdTokenForFirebaseSession({ googleIdToken: 'g', apiKey: 'k', signInEndpoint: `http://127.0.0.1:${port}` });
    assert.equal(result.identity.uid, 'firebase-uid-no-email');
    assert.equal(result.identity.email, undefined);
  } finally {
    server.close();
  }
});

test('rejects when Firebase does not return a localId, rather than silently accepting a userless session', async () => {
  const { server, port } = await startFakeServer((_req, _body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ idToken: 't', refreshToken: 'r' }));
  });
  try {
    await assert.rejects(
      () => exchangeGoogleIdTokenForFirebaseSession({ googleIdToken: 'g', apiKey: 'k', signInEndpoint: `http://127.0.0.1:${port}` }),
      /did not return a user id/,
    );
  } finally {
    server.close();
  }
});

test('surfaces a real Firebase rejection cleanly (e.g. an unwhitelisted OAuth client id) rather than a generic error', async () => {
  const { server, port } = await startFakeServer((_req, _body, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 400, message: 'INVALID_IDP_RESPONSE' } }));
  });
  try {
    await assert.rejects(
      () => exchangeGoogleIdTokenForFirebaseSession({ googleIdToken: 'g', apiKey: 'k', signInEndpoint: `http://127.0.0.1:${port}` }),
      /INVALID_IDP_RESPONSE/,
    );
  } finally {
    server.close();
  }
});

test('rejects immediately, without any request, when no Firebase API key is configured', async () => {
  await assert.rejects(
    () => exchangeGoogleIdTokenForFirebaseSession({ googleIdToken: 'g', apiKey: undefined }),
    /not configured/,
  );
});

// --- refreshFirebaseSession ---

test('refreshFirebaseSession sends the real refresh token as form-encoded grant_type=refresh_token', async () => {
  let capturedBody;
  const { server, port } = await startFakeServer((_req, rawBody, res) => {
    capturedBody = new URLSearchParams(rawBody);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ user_id: 'firebase-uid-123', id_token: 'new-id-token', refresh_token: 'new-refresh-token', expires_in: '3600' }));
  });
  try {
    const result = await refreshFirebaseSession({ refreshToken: 'old-refresh-token', apiKey: 'k', tokenEndpoint: `http://127.0.0.1:${port}` });
    assert.equal(capturedBody.get('grant_type'), 'refresh_token');
    assert.equal(capturedBody.get('refresh_token'), 'old-refresh-token');
    assert.deepEqual(result, { uid: 'firebase-uid-123', idToken: 'new-id-token', refreshToken: 'new-refresh-token' });
  } finally {
    server.close();
  }
});

test('refreshFirebaseSession rejects cleanly when the stored refresh token is no longer valid (e.g. revoked)', async () => {
  const { server, port } = await startFakeServer((_req, _body, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 400, message: 'TOKEN_EXPIRED' } }));
  });
  try {
    await assert.rejects(
      () => refreshFirebaseSession({ refreshToken: 'expired', apiKey: 'k', tokenEndpoint: `http://127.0.0.1:${port}` }),
      /TOKEN_EXPIRED/,
    );
  } finally {
    server.close();
  }
});

test('refreshFirebaseSession rejects immediately when no Firebase API key is configured', async () => {
  await assert.rejects(
    () => refreshFirebaseSession({ refreshToken: 'r', apiKey: undefined }),
    /not configured/,
  );
});
