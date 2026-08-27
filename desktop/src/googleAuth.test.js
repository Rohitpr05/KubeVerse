const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { signInWithGoogle, exchangeCodeForTokens, startLoopbackServer, waitForRedirect } = require('./googleAuth.js');

function fakeIdToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

// A fake local "Google" token endpoint - not a mock, a real HTTP server on
// 127.0.0.1 that this test's real fetch() call actually talks to. Lets the
// whole real flow (loopback server, real PKCE, real redirect handling, real
// token-exchange HTTP request) be exercised end-to-end without needing real
// Google credentials or network access - only the genuine Google consent
// screen (a human clicking "Allow") can't be exercised this way, which is
// exactly what the final report discloses as still requiring manual testing.
function startFakeGoogleTokenServer({ respondWith, capture }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (capture) capture(new URLSearchParams(body));
        res.writeHead(respondWith.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(respondWith.body));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('a full sign-in round trip: real loopback server + real PKCE + real redirect handling + real token exchange', async () => {
  const idToken = fakeIdToken({ sub: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' });
  let capturedTokenRequest;
  const { server: tokenServer, port: tokenPort } = await startFakeGoogleTokenServer({
    respondWith: { body: { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', id_token: idToken, expires_in: 3600 } },
    capture: (params) => { capturedTokenRequest = params; },
  });

  try {
    // Stands in for the system browser + the real Google consent screen:
    // parses the real authorization URL this module built, confirms it's
    // well-formed, then does what Google's own redirect would do - issue an
    // HTTP GET back to our real loopback redirect_uri with ?code&state.
    const openExternal = async (authUrlString) => {
      const authUrl = new URL(authUrlString);
      assert.equal(authUrl.searchParams.get('response_type'), 'code');
      assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(authUrl.searchParams.get('code_challenge'));
      assert.ok(authUrl.searchParams.get('state'));
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      await fetch(`${redirectUri}/?code=fake-auth-code&state=${state}`);
    };

    const result = await signInWithGoogle({
      clientId: 'test-client-id.apps.googleusercontent.com',
      openExternal,
      tokenEndpoint: `http://127.0.0.1:${tokenPort}`,
    });

    assert.deepEqual(result.identity, { sub: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' });
    assert.equal(result.refreshToken, 'fake-refresh-token');
    assert.equal(result.accessToken, 'fake-access-token');

    // Real proof the token exchange never sends a client_secret - the
    // actual POST body this module sent to the token endpoint, inspected
    // directly, not assumed from reading the source.
    assert.equal(capturedTokenRequest.has('client_secret'), false);
    assert.equal(capturedTokenRequest.get('grant_type'), 'authorization_code');
    assert.equal(capturedTokenRequest.get('code'), 'fake-auth-code');
    assert.ok(capturedTokenRequest.get('code_verifier'));
  } finally {
    tokenServer.close();
  }
});

test('rejects when the redirect carries a mismatched state (a real CSRF-style tampering scenario)', async () => {
  const { server, port } = await startLoopbackServer();
  try {
    const redirectPromise = waitForRedirect(server, 'the-real-expected-state');
    // Someone/something hits the redirect URI with the wrong state.
    fetch(`http://127.0.0.1:${port}/?code=some-code&state=a-different-state`).catch(() => {});
    await assert.rejects(redirectPromise, /[Ii]nvalid/);
  } finally {
    server.close();
  }
});

test('rejects when Google redirects back with an error (user denied consent)', async () => {
  const { server, port } = await startLoopbackServer();
  try {
    const redirectPromise = waitForRedirect(server, 'expected-state');
    fetch(`http://127.0.0.1:${port}/?error=access_denied&state=expected-state`).catch(() => {});
    await assert.rejects(redirectPromise, /cancelled or denied/);
  } finally {
    server.close();
  }
});

test('signInWithGoogle rejects immediately, without opening anything, when no client ID is configured', async () => {
  const openExternal = async () => { throw new Error('must not be called'); };
  await assert.rejects(
    () => signInWithGoogle({ clientId: undefined, openExternal }),
    /not configured/,
  );
});

test('exchangeCodeForTokens surfaces Google\'s own error_description on a failed exchange, not a raw HTTP dump', async () => {
  const { server, port } = await startFakeGoogleTokenServer({
    respondWith: { status: 400, body: { error: 'invalid_grant', error_description: 'Malformed auth code.' } },
  });
  try {
    await assert.rejects(
      () => exchangeCodeForTokens({ code: 'bad', codeVerifier: 'v', redirectUri: 'http://127.0.0.1:1', clientId: 'c', tokenEndpoint: `http://127.0.0.1:${port}` }),
      /Malformed auth code/,
    );
  } finally {
    server.close();
  }
});

test('the loopback server only ever binds to 127.0.0.1, never all interfaces', async () => {
  const { server, port } = await startLoopbackServer();
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.ok(port > 0);
  } finally {
    server.close();
  }
});

test('a whole sign-in attempt times out cleanly if the redirect never arrives (e.g. the user never finishes in the browser)', async () => {
  const openExternal = async () => { /* simulate a browser opening but the user never completing anything */ };
  await assert.rejects(
    () => signInWithGoogle({ clientId: 'test-client-id', openExternal, timeoutMs: 50 }),
    /timed out/,
  );
});
