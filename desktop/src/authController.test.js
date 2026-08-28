const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createAuthController } = require('./authController.js');

function fakeIdToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

// Two fake local servers - a real HTTP "Google" token endpoint and a real
// HTTP "Firebase" signInWithIdp endpoint - so a real sign-in round trip
// through *both* hops of the Phase 6 flow is exercised end to end, not
// mocked at the function-call boundary.
function startFakeGoogleTokenServer(tokenResponse) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(tokenResponse));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startFakeFirebaseServer(firebaseResponse) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(firebaseResponse));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function buildFakeElectron(userDataDir) {
  const handlers = new Map();
  const sentMessages = [];
  return {
    app: { getPath: (name) => (name === 'userData' ? userDataDir : userDataDir) },
    shell: { openExternal: undefined }, // set per-test
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
      decryptString: (buffer) => {
        const value = buffer.toString('utf8');
        if (!value.startsWith('enc:')) throw new Error('cannot decrypt');
        return value.slice('enc:'.length);
      },
    },
    invoke: (channel) => handlers.get(channel)(),
    getSentMessages: () => sentMessages,
    mainWindow: { isDestroyed: () => false, webContents: { send: (channel, state) => sentMessages.push({ channel, state }) } },
  };
}

function tempUserDataDir() {
  return mkdtempSync(join(tmpdir(), 'kubeverse-auth-controller-'));
}

// A real, complete Google-then-Firebase openExternal stand-in - simulates
// the system browser + Google consent screen (issuing a GET back to the
// real loopback server, exactly like googleAuth.test.js's own fake) so the
// *entire* real flow (loopback server, PKCE, both HTTP hops) runs for real.
function makeOpenExternal() {
  return async (authUrlString) => {
    const authUrl = new URL(authUrlString);
    const redirectUri = authUrl.searchParams.get('redirect_uri');
    const state = authUrl.searchParams.get('state');
    await fetch(`${redirectUri}/?code=fake-code&state=${state}`);
  };
}

test('a signed-out install reports {status: "signed_out"}, not stuck on loading', async () => {
  const dir = tempUserDataDir();
  try {
    const fake = buildFakeElectron(dir);
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key' });
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real sign-in round trip goes through both hops (Google then Firebase), persists encrypted, and broadcasts signed_in', async () => {
  const dir = tempUserDataDir();
  const googleIdToken = fakeIdToken({ sub: 'google-sub-should-be-unused', email: 'ada@example.com' });
  const { server: googleServer, port: googlePort } = await startFakeGoogleTokenServer({ access_token: 'gat', refresh_token: 'grt', id_token: googleIdToken });
  const { server: firebaseServer, port: firebasePort } = await startFakeFirebaseServer({
    localId: 'firebase-uid-real', email: 'ada@example.com', displayName: 'Ada Lovelace', photoUrl: 'https://example.com/a.jpg',
    idToken: 'firebase-id-token', refreshToken: 'firebase-refresh-token',
  });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = makeOpenExternal();
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key',
      tokenEndpoint: `http://127.0.0.1:${googlePort}`,
      signInEndpoint: `http://127.0.0.1:${firebasePort}`,
    });

    const signInResult = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(signInResult.success, true);
    // The Firebase UID is the identity, not Google's own "sub".
    assert.deepEqual(signInResult.identity, { uid: 'firebase-uid-real', email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' });

    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_in', identity: signInResult.identity });

    const broadcasts = fake.getSentMessages().filter((m) => m.channel === 'kubeverse:auth-state');
    assert.deepEqual(broadcasts.at(-1).state, { status: 'signed_in', identity: signInResult.identity });

    // Persisted file: identity in the clear, only the *Firebase* refresh
    // token (encrypted) - never Google's own tokens in any form.
    const persisted = JSON.parse(readFileSync(join(dir, 'auth-state.json'), 'utf8'));
    assert.equal(persisted.identity.uid, 'firebase-uid-real');
    const persistedRaw = JSON.stringify(persisted);
    assert.doesNotMatch(persistedRaw, /grt|gat|"firebase-refresh-token"|"firebase-id-token"/, 'no raw token, Google\'s or Firebase\'s, may appear in plaintext in the persisted file');
  } finally {
    googleServer.close();
    firebaseServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed sign-in returns a sanitized error via the IPC result, never a raw error, and leaves the broadcast state exactly as it was', async () => {
  const dir = tempUserDataDir();
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = async () => { throw new Error('user closed the browser'); };
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key' });

    const result = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(result.success, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.identity, undefined);

    // "Google cancellation should return cleanly to signed_out" - the
    // broadcast/queryable state was signed_out before the attempt and
    // remains signed_out after a failed one, never a stuck error state.
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Firebase-side rejection (e.g. an unwhitelisted OAuth client) also fails cleanly, sanitized, without ever reaching signed_in', async () => {
  const dir = tempUserDataDir();
  const googleIdToken = fakeIdToken({ sub: 'google-sub', email: 'ada@example.com' });
  const { server: googleServer, port: googlePort } = await startFakeGoogleTokenServer({ access_token: 'gat', refresh_token: 'grt', id_token: googleIdToken });
  const { server: firebaseServer, port: firebasePort } = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 400, message: 'INVALID_IDP_RESPONSE' } }));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = makeOpenExternal();
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key',
      tokenEndpoint: `http://127.0.0.1:${googlePort}`, signInEndpoint: `http://127.0.0.1:${firebasePort}`,
    });
    const result = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(result.success, false);
    assert.match(result.error, /INVALID_IDP_RESPONSE/);
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
  } finally {
    googleServer.close();
    firebaseServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The core privacy proof for this whole controller: every return value and
// every broadcast this test observes is checked for the presence of the
// real access/refresh token strings from *both* hops - they must never
// appear anywhere the renderer could see them.
test('no access or refresh token, from either Google or Firebase, ever appears in any IPC return value or broadcast', async () => {
  const dir = tempUserDataDir();
  const googleIdToken = fakeIdToken({ sub: 'google-sub' });
  const { server: googleServer, port: googlePort } = await startFakeGoogleTokenServer({ access_token: 'super-secret-google-access-token', refresh_token: 'super-secret-google-refresh-token', id_token: googleIdToken });
  const { server: firebaseServer, port: firebasePort } = await startFakeFirebaseServer({ localId: 'firebase-uid', idToken: 'super-secret-firebase-id-token', refreshToken: 'super-secret-firebase-refresh-token' });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = makeOpenExternal();
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key',
      tokenEndpoint: `http://127.0.0.1:${googlePort}`, signInEndpoint: `http://127.0.0.1:${firebasePort}`,
    });

    const signInResult = await fake.invoke('kubeverse:auth-sign-in');
    const getStateResult = await fake.invoke('kubeverse:auth-get-state');
    const everythingObservable = JSON.stringify({ signInResult, getStateResult, broadcasts: fake.getSentMessages() });

    for (const secret of ['super-secret-google-access-token', 'super-secret-google-refresh-token', 'super-secret-firebase-id-token', 'super-secret-firebase-refresh-token']) {
      assert.doesNotMatch(everythingObservable, new RegExp(secret));
    }
  } finally {
    googleServer.close();
    firebaseServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign-out clears the persisted state, broadcasts {status: "signed_out"}, and never touches unrelated files', async () => {
  const dir = tempUserDataDir();
  const googleIdToken = fakeIdToken({ sub: 'google-sub' });
  const { server: googleServer, port: googlePort } = await startFakeGoogleTokenServer({ access_token: 'gat', refresh_token: 'grt', id_token: googleIdToken });
  const { server: firebaseServer, port: firebasePort } = await startFakeFirebaseServer({ localId: 'firebase-uid', idToken: 'fit', refreshToken: 'frt' });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = makeOpenExternal();
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: 'test-firebase-key',
      tokenEndpoint: `http://127.0.0.1:${googlePort}`, signInEndpoint: `http://127.0.0.1:${firebasePort}`,
    });
    await fake.invoke('kubeverse:auth-sign-in');

    const unrelatedFile = join(dir, 'setup-state.json');
    require('node:fs').writeFileSync(unrelatedFile, JSON.stringify({ setupComplete: true }));

    const signOutResult = await fake.invoke('kubeverse:auth-sign-out');
    assert.equal(signOutResult, true);

    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
    assert.equal(require('node:fs').existsSync(join(dir, 'auth-state.json')), false);
    assert.equal(require('node:fs').existsSync(unrelatedFile), true, 'sign-out must never delete unrelated local files');

    const broadcasts = fake.getSentMessages().filter((m) => m.channel === 'kubeverse:auth-state');
    assert.deepEqual(broadcasts.at(-1).state, { status: 'signed_out' });
  } finally {
    googleServer.close();
    firebaseServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a returning launch with a previously-persisted identity restores {status: "signed_in"} without any network call', async () => {
  const dir = tempUserDataDir();
  const { writeAuthState } = require('./authState.js');
  const encrypt = (text) => Buffer.from(`enc:${text}`, 'utf8');
  writeAuthState(join(dir, 'auth-state.json'), { identity: { uid: 'returning-user', email: 'a@b.com' }, refreshToken: 'rt' }, encrypt);

  const fake = buildFakeElectron(dir);
  // openExternal deliberately left undefined, and no firebaseApiKey given
  // to the background-refresh path either (it would fail loudly if it tried
  // a real network call here) - restoring a session must never attempt any
  // network/browser interaction on the ordinary launch path.
  try {
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' });
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_in', identity: { uid: 'returning-user', email: 'a@b.com', name: undefined, picture: undefined } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupted persisted auth file restores as signed_out on launch, never throws', async () => {
  const dir = tempUserDataDir();
  require('node:fs').writeFileSync(join(dir, 'auth-state.json'), '{ not valid json');
  const fake = buildFakeElectron(dir);
  try {
    assert.doesNotThrow(() => createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' }));
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign-in fails cleanly, sanitized, when Google succeeds but no Firebase API key is configured - never a raw error, never a fake success', async () => {
  const dir = tempUserDataDir();
  const googleIdToken = fakeIdToken({ sub: 'google-sub' });
  const { server: googleServer, port: googlePort } = await startFakeGoogleTokenServer({ access_token: 'gat', refresh_token: 'grt', id_token: googleIdToken });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = makeOpenExternal();
    // clientId IS configured, so googleAuth.js's own part of the flow
    // succeeds normally (Phase 5's step can't know Firebase isn't
    // configured ahead of time) - what matters is the overall attempt still
    // fails cleanly once the Firebase step is reached, never silently
    // succeeding or crashing, and the state stays signed_out.
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', firebaseApiKey: undefined,
      tokenEndpoint: `http://127.0.0.1:${googlePort}`,
    });
    const result = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(result.success, false);
    assert.match(result.error, /not configured/);
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { status: 'signed_out' });
  } finally {
    googleServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
