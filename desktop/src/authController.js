// Wires googleAuth.js (Phase 5, unchanged) + firebaseAuth.js (Phase 6) +
// authState.js into Electron - the main-process-only owner of every
// privileged authentication operation (KUBEVERSE_MASTER_SPEC.md, "Desktop
// OAuth architecture"). Mirrors updater.js's own controller shape: a narrow
// set of IPC handlers, a broadcast of read-only state to the renderer,
// nothing privileged ever crossing that boundary.
//
// Phase 6 architecture, chosen after auditing Phase 5 and researching
// Firebase's current documented approach (2026-08-28) rather than rewriting
// what already worked: Phase 5's entire PKCE/loopback/system-browser flow
// (googleAuth.js) is reused as-is to obtain a real Google ID token - it
// already does the hard, security-sensitive part correctly. This file adds
// exactly one new step after that succeeds: exchange the Google ID token
// for a real Firebase session via firebaseAuth.js's plain REST call to
// Firebase's own public Identity Toolkit API (no Admin SDK, no Cloud
// Function, no KubeVerse-owned server - see firebaseAuth.js's own comment
// for why that rules out the Cloud-Function-based pattern some Electron+
// Firebase guides use). Google's own access/refresh tokens are discarded
// immediately after this exchange; only Firebase's session (uid/idToken/
// refreshToken) is ever persisted.
//
// Critically, `broadcast`/`latestState` and every IPC handler's return value
// carry ONLY the minimal identity (uid/email/name/picture) - no access/
// refresh token, Google's or Firebase's, ever leaves this function's
// closure. They are encrypted (via the injected `safeStorage`) and written
// to disk by authState.js and otherwise held only in memory here;
// preload.js exposes no channel that could ever return them.
//
// `app`/`shell`/`ipcMain`/`safeStorage` are injected rather than
// require('electron')'d directly, so this whole controller - including a
// real sign-in round trip against fake local "Google" and "Firebase"
// servers - is testable via plain node:test (see authController.test.js),
// the same testability discipline googleAuth.js/firebaseAuth.js/authState.js
// already follow.
const { join } = require('node:path');
const { readAuthState, writeAuthState, clearAuthState } = require('./authState.js');
const { signInWithGoogle } = require('./googleAuth.js');
const { exchangeGoogleIdTokenForFirebaseSession, refreshFirebaseSession } = require('./firebaseAuth.js');
const { sanitizeAuthError } = require('./sanitizeAuthError.js');

function createAuthController({
  app, shell, ipcMain, safeStorage, getMainWindow,
  clientId, firebaseApiKey,
  authEndpoint, tokenEndpoint, signInEndpoint, firebaseTokenEndpoint,
}) {
  function authStatePath() {
    return join(app.getPath('userData'), 'auth-state.json');
  }

  // safeStorage (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on
  // Linux) is Electron's own built-in OS-native secure-storage API - no new
  // dependency, no homemade encryption (KUBEVERSE_MASTER_SPEC.md: "do not
  // invent unnecessary custom encryption when the OS provides an appropriate
  // secure store"). isEncryptionAvailable() can genuinely be false (no OS
  // keyring available/unlocked, e.g. some minimal Linux setups) - in that
  // case a refresh token is simply never persisted, so the user just signs
  // in again next launch, rather than ever writing it to disk in plaintext.
  function encrypt(text) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(text);
  }
  function decrypt(buffer) {
    return safeStorage.decryptString(buffer);
  }

  // Explicit states (loading/signed_out/signed_in), matching the frontend's
  // own AuthState shape (frontend/src/authLogic.ts) so both sides agree on
  // vocabulary - 'loading' exists specifically so the renderer never has to
  // guess/flash a wrong initial state before the real local answer is known
  // (the exact bug class Phase 3's onboarding gating already fixed with its
  // own three-state undefined/true/false pattern). A failed/cancelled
  // sign-in attempt is deliberately NOT a broadcast state - it is returned
  // once, directly, from the 'auth-sign-in' IPC call's own result
  // (§ "Google cancellation should return cleanly to signed_out": the
  // underlying local session is simply whatever it already was, never
  // corrupted or left stuck showing an error forever).
  let latestState = { status: 'loading' };

  function broadcast(state) {
    latestState = state;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('kubeverse:auth-state', state);
  }

  // Restoring a session on a later launch (§ "Returning Users") never
  // *requires* contacting Firebase/Google at all - the locally stored,
  // already-verified identity is trusted immediately for display, so the
  // app never blocks or looks broken while offline. This is also why "local
  // projects remain accessible independently of cloud connectivity" is true
  // by construction here, not just by intention.
  const stored = readAuthState(authStatePath(), decrypt);
  latestState = stored ? { status: 'signed_in', identity: stored.identity } : { status: 'signed_out' };

  // A lazy, opportunistic, once-per-launch background session refresh -
  // same "5 seconds after load, non-blocking, unref'd" pattern
  // desktop/src/main.js's own update-check already uses. Purely best-effort:
  // Firebase refresh tokens can rotate, so a successful refresh re-persists
  // the new one; a *failed* refresh (offline, or a genuinely revoked
  // session) never signs the user out automatically here - distinguishing
  // "temporarily unreachable" from "actually revoked" reliably would need
  // more machinery than this phase's own "local-first, do not overreach"
  // priorities justify, and incorrectly signing someone out from a flaky
  // network blip would be a real regression, not a safety improvement. The
  // user's own explicit "Sign out" action is still the one one reliable way
  // to end a session.
  if (stored?.refreshToken && firebaseApiKey) {
    const timer = setTimeout(() => {
      refreshFirebaseSession({ refreshToken: stored.refreshToken, apiKey: firebaseApiKey, tokenEndpoint: firebaseTokenEndpoint })
        .then((refreshed) => {
          const encrypted = encrypt(refreshed.refreshToken);
          if (encrypted) writeAuthState(authStatePath(), { identity: stored.identity, refreshToken: refreshed.refreshToken }, encrypt);
        })
        .catch((error) => {
          console.error('KubeVerse Firebase session refresh failed:', sanitizeAuthError(error));
        });
    }, 5000);
    timer.unref?.();
  }

  ipcMain.handle('kubeverse:auth-get-state', () => latestState);

  ipcMain.handle('kubeverse:auth-sign-in', async () => {
    try {
      // Step 1 (Phase 5, unchanged): a real Google ID token via system-
      // browser PKCE.
      const google = await signInWithGoogle({
        clientId,
        authEndpoint,
        tokenEndpoint,
        openExternal: (url) => shell.openExternal(url),
      });
      // Step 2 (Phase 6): exchange it for a real Firebase session. Google's
      // own access/refresh tokens (google.accessToken/google.refreshToken)
      // are deliberately never used again past this point - only the raw ID
      // token (a signed assertion of identity, not a credential granting
      // API access) is handed to Firebase.
      const firebase = await exchangeGoogleIdTokenForFirebaseSession({
        googleIdToken: google.idToken,
        apiKey: firebaseApiKey,
        signInEndpoint,
      });
      const encryptedRefreshToken = firebase.refreshToken ? encrypt(firebase.refreshToken) : null;
      writeAuthState(
        authStatePath(),
        { identity: firebase.identity, refreshToken: encryptedRefreshToken ? firebase.refreshToken : undefined },
        encrypt,
      );
      broadcast({ status: 'signed_in', identity: firebase.identity });
      return { success: true, identity: firebase.identity };
    } catch (error) {
      console.error('KubeVerse Google sign-in failed:', error);
      return { success: false, error: sanitizeAuthError(error) };
    }
  });

  // Logout only ever deletes this one file (authState.js's clearAuthState) -
  // it never receives, and has no way to derive, a project or settings
  // path, so it structurally cannot touch project data, architecture.md,
  // generated code, or the AI API key (KUBEVERSE_MASTER_SPEC.md, "Logout").
  ipcMain.handle('kubeverse:auth-sign-out', () => {
    clearAuthState(authStatePath());
    broadcast({ status: 'signed_out' });
    return true;
  });

  return { getState: () => latestState };
}

module.exports = { createAuthController };
