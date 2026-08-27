// Local, encrypted-at-rest persistence for "who is signed in with Google"
// (KUBEVERSE_MASTER_SPEC.md, "Local-first privacy") - never project data,
// never API keys, never generated code; a completely separate concern from
// backend/src/local/settings.ts's AI-provider storage and from
// setupState.js's onboarding flag, living in its own file.
//
// encrypt/decrypt are injected, not required here, for two reasons: (1) the
// real implementation is Electron's safeStorage (OS Keychain/DPAPI/
// libsecret), which only works inside a real Electron process - injecting
// it keeps this file's own JSON-shape/round-trip/corrupt-file logic
// testable via plain node:test, the same pattern setupState.js and
// backendProcess.js already use for their own Electron-free testability;
// (2) it lets authController.js (the real caller) own the one place that
// decides what "encrypted" actually means, instead of this file assuming.
const { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { dirname } = require('node:path');

// A corrupt file, an unparsable JSON shape, or a refresh token that no
// longer decrypts (e.g. the OS keychain entry was removed/changed outside
// KubeVerse) are all treated identically to "not signed in" - never thrown,
// matching setupState.js's own corrupt-file handling. This is also this
// phase's concrete answer to "malformed local identity data" and
// "expired/invalid session" (KUBEVERSE_MASTER_SPEC.md, Phase 5): since this
// phase never makes a live call to validate a session, the only honest local
// signal for "this session is no longer good" is exactly this - the stored
// state failing to parse/decrypt cleanly.
function readAuthState(filePath, decrypt) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.identity || typeof raw.identity.sub !== 'string' || !raw.identity.sub) {
      return null;
    }
    const identity = {
      sub: raw.identity.sub,
      email: typeof raw.identity.email === 'string' ? raw.identity.email : undefined,
      name: typeof raw.identity.name === 'string' ? raw.identity.name : undefined,
      picture: typeof raw.identity.picture === 'string' ? raw.identity.picture : undefined,
    };
    const refreshToken = typeof raw.encryptedRefreshToken === 'string'
      ? decrypt(Buffer.from(raw.encryptedRefreshToken, 'base64'))
      : undefined;
    return { identity, refreshToken, updatedAt: raw.updatedAt };
  } catch {
    return null;
  }
}

function writeAuthState(filePath, state, encrypt) {
  mkdirSync(dirname(filePath), { recursive: true });
  const encryptedRefreshToken = state.refreshToken ? encrypt(state.refreshToken).toString('base64') : undefined;
  const payload = {
    identity: {
      sub: state.identity.sub,
      email: state.identity.email,
      name: state.identity.name,
      picture: state.identity.picture,
    },
    encryptedRefreshToken,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

// Logout (KUBEVERSE_MASTER_SPEC.md, "Logout only affects authentication"):
// deletes exactly this one file, never anything under the project workspace
// or backend/src/local/settings.ts's own storage - the caller (authController.js)
// never receives a project path or API-key path to delete, so there is no
// code path here that could reach either even by mistake.
function clearAuthState(filePath) {
  try {
    rmSync(filePath, { force: true });
  } catch {
    /* nothing to clear */
  }
}

module.exports = { readAuthState, writeAuthState, clearAuthState };
