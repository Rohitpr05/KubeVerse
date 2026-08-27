// Wires googleAuth.js + authState.js into Electron - the main-process-only
// owner of every privileged authentication operation (KUBEVERSE_MASTER_SPEC.md,
// "Desktop OAuth architecture"). Mirrors updater.js's own controller shape:
// a narrow set of IPC handlers, a broadcast of read-only state to the
// renderer, nothing privileged ever crossing that boundary.
//
// Critically, `broadcast`/`latestState` and every IPC handler's return value
// carry ONLY the minimal identity (sub/email/name/picture) - the OAuth
// access/refresh tokens obtained in signInWithGoogle() never leave this
// function's closure. They are encrypted (via the injected `safeStorage`)
// and written to disk by authState.js and otherwise held only in memory
// here; preload.js exposes no channel that could ever return them.
//
// `app`/`shell`/`ipcMain`/`safeStorage` are injected rather than
// require('electron')'d directly, so this whole controller - including a
// real sign-in round trip against a fake local "Google" - is testable via
// plain node:test (see authController.test.js), the same testability
// discipline googleAuth.js and authState.js already follow.
const { join } = require('node:path');
const { readAuthState, writeAuthState, clearAuthState } = require('./authState.js');
const { signInWithGoogle } = require('./googleAuth.js');
const { sanitizeAuthError } = require('./sanitizeAuthError.js');

function createAuthController({ app, shell, ipcMain, safeStorage, getMainWindow, clientId, authEndpoint, tokenEndpoint }) {
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

  let latestState = { signedIn: false };

  function broadcast(state) {
    latestState = state;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('kubeverse:auth-state', state);
  }

  // Restoring a session on a later launch (§ "Returning Users") never
  // contacts Google at all - the locally stored, already-verified identity
  // (captured directly from Google's own token endpoint at the original
  // sign-in) is trusted as-is. This is also why "local projects remain
  // accessible independently of cloud connectivity" is true by construction
  // here, not just by intention: nothing on the ordinary launch path makes
  // a network call.
  const stored = readAuthState(authStatePath(), decrypt);
  if (stored) latestState = { signedIn: true, identity: stored.identity };

  ipcMain.handle('kubeverse:auth-get-state', () => latestState);

  ipcMain.handle('kubeverse:auth-sign-in', async () => {
    try {
      const result = await signInWithGoogle({
        clientId,
        authEndpoint,
        tokenEndpoint,
        openExternal: (url) => shell.openExternal(url),
      });
      const encryptedRefreshToken = result.refreshToken ? encrypt(result.refreshToken) : null;
      writeAuthState(
        authStatePath(),
        { identity: result.identity, refreshToken: encryptedRefreshToken ? result.refreshToken : undefined },
        encrypt,
      );
      const nextState = { signedIn: true, identity: result.identity };
      broadcast(nextState);
      return { success: true, identity: result.identity };
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
    broadcast({ signedIn: false });
    return true;
  });

  return { getState: () => latestState };
}

module.exports = { createAuthController };
