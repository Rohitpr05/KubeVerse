// Exchanges the real Google ID token obtained by googleAuth.js's PKCE flow
// for a real Firebase Authentication session - via Firebase's own public
// Identity Toolkit REST API, never the Admin SDK, never a Cloud Function,
// never a KubeVerse-owned server. Plain `fetch`, zero new dependencies,
// exactly like googleAuth.js's own token exchange.
//
// Why this architecture, not a rewrite of Phase 5's OAuth flow: researched
// current Firebase/Google guidance before choosing (2026-08-28). Some
// real-world Electron+Firebase integrations use a Cloud Function + the
// Firebase Admin SDK to mint a custom token - that requires a privileged
// service-account credential and a KubeVerse-owned server component, both
// explicitly forbidden by this phase's own data boundary. The
// `accounts:signInWithIdp` REST endpoint is Firebase's own documented,
// public, Admin-SDK-free path for exactly this case: hand it a Google ID
// token, get back a real Firebase user (localId/idToken/refreshToken/email/
// displayName/photoUrl), no server in between
// (https://docs.cloud.google.com/identity-platform/docs/use-rest-api,
// https://firebase.google.com/docs/reference/rest/auth). Phase 5's entire
// PKCE/loopback/system-browser flow (googleAuth.js) is unchanged and reused
// as-is - it already does the hard, security-sensitive part (getting a
// real, verified Google ID token); this module only adds the one new step
// Firebase needs on top of it.
//
// The Firebase "Web API key" used in these URLs is not a secret - Firebase's
// own security checklist states API keys restricted to Firebase services
// "do not need to be treated as secrets, and it's safe to include them in
// your code or configuration files" (unlike an Admin SDK service-account
// private key, which must never be shipped and never is here).
const FIREBASE_SIGN_IN_WITH_IDP_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const FIREBASE_TOKEN_ENDPOINT = 'https://securetoken.googleapis.com/v1/token';

function toIdentity(payload) {
  if (typeof payload.localId !== 'string' || !payload.localId) {
    throw new Error('Firebase sign-in did not return a user id.');
  }
  return {
    uid: payload.localId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.displayName === 'string' ? payload.displayName : undefined,
    picture: typeof payload.photoUrl === 'string' ? payload.photoUrl : undefined,
  };
}

// googleIdToken is Google's ID token from googleAuth.js's signInWithGoogle()
// (never Google's access/refresh token - those are discarded immediately
// after this call, since nothing in KubeVerse calls any other Google API).
async function exchangeGoogleIdTokenForFirebaseSession({ googleIdToken, apiKey, signInEndpoint = FIREBASE_SIGN_IN_WITH_IDP_ENDPOINT }) {
  if (!apiKey) throw new Error('Firebase is not configured on this build.');
  const url = new URL(signInEndpoint);
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // requestUri must be a syntactically valid URI but its value is not
      // otherwise significant for this native-app flow (no browser redirect
      // is actually happening at this point - the real redirect already
      // completed inside googleAuth.js's own loopback server).
      requestUri: 'http://localhost',
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Firebase sign-in could not be completed (${json.error?.message || response.status}).`);
  }
  return {
    identity: toIdentity(json),
    idToken: json.idToken,
    refreshToken: json.refreshToken,
  };
}

async function refreshFirebaseSession({ refreshToken, apiKey, tokenEndpoint = FIREBASE_TOKEN_ENDPOINT }) {
  if (!apiKey) throw new Error('Firebase is not configured on this build.');
  const url = new URL(tokenEndpoint);
  url.searchParams.set('key', apiKey);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Firebase session refresh failed (${json.error?.message || response.status}).`);
  }
  // The refresh endpoint's response uses snake_case field names (it's the
  // plain OAuth2 token-refresh shape, distinct from signInWithIdp's
  // camelCase user-record shape) - user_id is the same Firebase UID as
  // signInWithIdp's localId.
  return { uid: json.user_id, idToken: json.id_token, refreshToken: json.refresh_token };
}

module.exports = {
  exchangeGoogleIdTokenForFirebaseSession,
  refreshFirebaseSession,
  FIREBASE_SIGN_IN_WITH_IDP_ENDPOINT,
  FIREBASE_TOKEN_ENDPOINT,
};
