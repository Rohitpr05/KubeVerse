// Google desktop OAuth flow - Authorization Code + PKCE via a loopback
// redirect (RFC 8252 "OAuth 2.0 for Native Apps"; Google's current native-app
// guidance, verified 2026-08-27: https://developers.google.com/identity/protocols/oauth2/native-app).
// The consent screen opens in the user's system default browser
// (shell.openExternal, injected as `openExternal` - see authController.js),
// never an embedded Electron BrowserWindow/webview: Google has blocked
// OAuth via embedded webviews since 2023 specifically against credential-
// phishing risk, and that restriction remains in force (verified via
// Google's own OAuth 2.0 Policies page and developer blog post, same date).
//
// No client_secret is ever sent or stored: a "Desktop app" OAuth client is a
// public client per RFC 8252 §8.5 (native apps "cannot keep secrets" -
// anything embedded in a distributed binary is not confidential no matter
// how it's obfuscated). PKCE's code_verifier/code_challenge is what actually
// secures this exchange instead.
//
// authEndpoint/tokenEndpoint/timeoutMs are overridable purely for testing -
// this whole module (real loopback HTTP server, real PKCE, real redirect
// handling) is exercised end-to-end in googleAuth.test.js against a local
// fake "Google" server, without needing real Google credentials or network
// access, only Google's own two endpoints default in real use.
const http = require('node:http');
const { generateCodeVerifier, generateCodeChallenge, generateState } = require('./pkce.js');
const { decodeIdTokenPayload } = require('./idToken.js');

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = 'openid email profile';

function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    // 127.0.0.1 explicitly, not '0.0.0.0'/unspecified - this server must
    // only ever be reachable from this same machine.
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve({ server, port: server.address().port });
    });
  });
}

function waitForRedirect(server, expectedState) {
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
      } catch {
        res.writeHead(400).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (error) {
        res.end('<html><body>Sign-in was not completed. You can close this tab and return to KubeVerse.</body></html>');
        reject(new Error('Google sign-in was cancelled or denied.'));
        return;
      }
      if (!code || !state || state !== expectedState) {
        res.end('<html><body>This sign-in link is invalid or expired. Please try again from KubeVerse.</body></html>');
        reject(new Error('Invalid or missing sign-in response.'));
        return;
      }
      res.end('<html><body>Signed in to KubeVerse. You can close this tab and return to the app.</body></html>');
      resolve(code);
    });
  });
}

async function exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId, tokenEndpoint }) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google sign-in could not be completed (${json.error || response.status}): ${json.error_description || 'unknown error'}`);
  }
  return json;
}

// Not called anywhere yet in this phase (KubeVerse only ever displays the
// identity captured at sign-in - it makes no other authenticated Google API
// call), kept as a small, tested, unwired utility for when a future phase
// needs a live token - the same "build the interface, wire it later"
// pattern backend/src/execution/*.ts already established for
// composeUp/applyManifests in Phase 1.
async function refreshAccessToken({ refreshToken, clientId, tokenEndpoint = GOOGLE_TOKEN_ENDPOINT }) {
  const body = new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google session refresh failed (${json.error || response.status}): ${json.error_description || 'unknown error'}`);
  }
  return json;
}

async function signInWithGoogle({
  clientId,
  openExternal,
  authEndpoint = GOOGLE_AUTH_ENDPOINT,
  tokenEndpoint = GOOGLE_TOKEN_ENDPOINT,
  timeoutMs = 5 * 60_000,
}) {
  if (!clientId) throw new Error('Google sign-in is not configured on this build.');

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const { server, port } = await startLoopbackServer();
  const redirectUri = `http://127.0.0.1:${port}`;

  try {
    const authUrl = new URL(authEndpoint);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    // offline + consent: Google only issues a refresh_token on a consent
    // grant, not on a silent re-approval - required since restoring a
    // session on a later launch (§ "Returning Users") must not require
    // logging in again every time.
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const redirectPromise = waitForRedirect(server, state);
    await openExternal(authUrl.toString());

    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out. Please try again.')), timeoutMs);
      timer.unref?.();
    });
    const code = await Promise.race([redirectPromise, timeout]);

    const tokens = await exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId, tokenEndpoint });
    const identity = decodeIdTokenPayload(tokens.id_token);
    return { identity, refreshToken: tokens.refresh_token, accessToken: tokens.access_token };
  } finally {
    server.close();
  }
}

module.exports = {
  signInWithGoogle,
  refreshAccessToken,
  // Exported for focused unit testing of each stage independently.
  startLoopbackServer,
  waitForRedirect,
  exchangeCodeForTokens,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
};
