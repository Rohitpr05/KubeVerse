const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readAuthState, writeAuthState, clearAuthState } = require('./authState.js');

// A fake, deterministic, injectable "encryption" for testing - real usage
// (authController.js) injects Electron's safeStorage instead. This proves
// authState.js's own JSON-shape/round-trip/corrupt-file logic without
// needing a real Electron process, matching setupState.js/backendProcess.js's
// established testability pattern.
function fakeEncrypt(text) {
  return Buffer.from(`enc:${text}`, 'utf8');
}
function fakeDecrypt(buffer) {
  const value = buffer.toString('utf8');
  if (!value.startsWith('enc:')) throw new Error('cannot decrypt');
  return value.slice('enc:'.length);
}

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-auth-state-'));
  return { dir, file: join(dir, 'auth-state.json') };
}

test('readAuthState returns null when no file exists yet (signed out)', () => {
  const { dir, file } = tempFile();
  try {
    assert.equal(readAuthState(file, fakeDecrypt), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAuthState then readAuthState round-trips the identity and decrypted refresh token', () => {
  const { dir, file } = tempFile();
  try {
    const identity = { uid: 'user-123', email: 'user@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' };
    writeAuthState(file, { identity, refreshToken: 'refresh-token-value' }, fakeEncrypt);
    const result = readAuthState(file, fakeDecrypt);
    assert.deepEqual(result.identity, identity);
    assert.equal(result.refreshToken, 'refresh-token-value');
    assert.ok(result.updatedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the refresh token is never written to disk in plaintext - only the encrypted form appears in the file', () => {
  const { dir, file } = tempFile();
  try {
    writeAuthState(file, { identity: { uid: 'user-123' }, refreshToken: 'super-secret-refresh-token' }, fakeEncrypt);
    const raw = require('node:fs').readFileSync(file, 'utf8');
    assert.doesNotMatch(raw, /super-secret-refresh-token/, 'plaintext refresh token must never appear in the persisted file');
    assert.match(raw, /encryptedRefreshToken/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAuthState creates its parent directory if missing (a fresh userData dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-auth-state-'));
  const file = join(dir, 'nested', 'deeper', 'auth-state.json');
  try {
    writeAuthState(file, { identity: { uid: 'user-123' } }, fakeEncrypt);
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAuthState with no refresh token omits encryptedRefreshToken entirely (e.g. safeStorage unavailable)', () => {
  const { dir, file } = tempFile();
  try {
    writeAuthState(file, { identity: { uid: 'user-123' } }, fakeEncrypt);
    const result = readAuthState(file, fakeDecrypt);
    assert.equal(result.refreshToken, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression coverage for "malformed local identity data" / "expired or
// invalid session handling" (KUBEVERSE_MASTER_SPEC.md, Phase 5 testing
// requirements): since this phase never makes a live call to re-validate a
// session, the only honest local signal for "this session is no longer
// good" is the stored state failing to parse/decrypt - all of these must be
// treated as "signed out", never throw.
test('a corrupt (non-JSON) auth-state file is treated as signed out, never throws', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, '{ not valid json');
    assert.equal(readAuthState(file, fakeDecrypt), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a well-formed file missing a usable identity.uid is treated as signed out', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, JSON.stringify({ identity: { email: 'user@example.com' } }));
    assert.equal(readAuthState(file, fakeDecrypt), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refresh token that fails to decrypt (e.g. OS keychain entry changed/removed) is treated as signed out', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, JSON.stringify({
      identity: { uid: 'user-123' },
      encryptedRefreshToken: Buffer.from('not-actually-encrypted-by-us').toString('base64'),
    }));
    assert.equal(readAuthState(file, fakeDecrypt), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an identity payload with extraneous fields is normalized to only uid/email/name/picture', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, JSON.stringify({ identity: { uid: 'user-123', email: 'a@b.com', aud: 'client-id', hd: 'example.com' } }));
    const result = readAuthState(file, fakeDecrypt);
    assert.deepEqual(Object.keys(result.identity).sort(), ['email', 'name', 'picture', 'uid']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Logout proof: clearAuthState only ever touches the one file path it's
// given - it has no project-path/settings-path parameter at all, so there
// is no code path here that could delete project data (KUBEVERSE_MASTER_SPEC.md,
// "Logout must only affect authentication").
test('clearAuthState deletes only the auth-state file, nothing else in its directory', () => {
  const { dir, file } = tempFile();
  const unrelatedFile = join(dir, 'architecture.md');
  try {
    writeAuthState(file, { identity: { uid: 'user-123' } }, fakeEncrypt);
    writeFileSync(unrelatedFile, '# a real project file that must survive logout');
    clearAuthState(file);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(unrelatedFile), true);
    assert.equal(readFileSyncSafe(unrelatedFile), '# a real project file that must survive logout');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearAuthState on an already-missing file does not throw', () => {
  const { dir, file } = tempFile();
  try {
    clearAuthState(file); // never written
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readFileSyncSafe(path) {
  return require('node:fs').readFileSync(path, 'utf8');
}
