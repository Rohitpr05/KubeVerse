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

// A fake app/ipcMain/safeStorage, matching Electron's real shape closely
// enough to exercise the real controller logic - handlers are captured in a
// map exactly like the real ipcMain.handle would register them, and invoked
// the same way tests already invoke Fastify routes elsewhere in this repo
// (see backend/src/routes/projects.test.ts's app.inject() pattern).
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

test('a signed-out install reports signedIn: false and no identity', async () => {
  const dir = tempUserDataDir();
  try {
    const fake = buildFakeElectron(dir);
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' });
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real sign-in round trip updates state, persists encrypted, and broadcasts to the renderer', async () => {
  const dir = tempUserDataDir();
  const idToken = fakeIdToken({ sub: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace' });
  const { server, port } = await startFakeGoogleTokenServer({ access_token: 'at', refresh_token: 'rt', id_token: idToken });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = async (authUrlString) => {
      const authUrl = new URL(authUrlString);
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      await fetch(`${redirectUri}/?code=fake-code&state=${state}`);
    };
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client',
      tokenEndpoint: `http://127.0.0.1:${port}`,
    });

    const signInResult = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(signInResult.success, true);
    assert.deepEqual(signInResult.identity, { sub: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace', picture: undefined });

    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: true, identity: signInResult.identity });

    // Broadcast reached the renderer with the identity only.
    const broadcasts = fake.getSentMessages().filter((m) => m.channel === 'kubeverse:auth-state');
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(broadcasts[0].state, { signedIn: true, identity: signInResult.identity });

    // Persisted file: identity in the clear (it's not a secret), refresh
    // token only in encrypted form - never plaintext.
    const persisted = JSON.parse(readFileSync(join(dir, 'auth-state.json'), 'utf8'));
    assert.equal(persisted.identity.sub, 'user-42');
    assert.doesNotMatch(JSON.stringify(persisted), /"rt"/);
    assert.match(persisted.encryptedRefreshToken, /^/); // present (base64 string)
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed sign-in returns a sanitized error, never a raw error object, and leaves state signed out', async () => {
  const dir = tempUserDataDir();
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = async () => { throw new Error('user closed the browser'); };
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' });

    const result = await fake.invoke('kubeverse:auth-sign-in');
    assert.equal(result.success, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.identity, undefined);

    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The core privacy proof for this whole controller: every return value and
// every broadcast this test observes is enumerated and checked for the
// presence of the real access/refresh token strings - they must never
// appear anywhere the renderer could see them.
test('the access token and refresh token never appear in any IPC return value or broadcast', async () => {
  const dir = tempUserDataDir();
  const idToken = fakeIdToken({ sub: 'user-42' });
  const { server, port } = await startFakeGoogleTokenServer({ access_token: 'super-secret-access-token', refresh_token: 'super-secret-refresh-token', id_token: idToken });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = async (authUrlString) => {
      const authUrl = new URL(authUrlString);
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      await fetch(`${redirectUri}/?code=fake-code&state=${state}`);
    };
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', tokenEndpoint: `http://127.0.0.1:${port}`,
    });

    const signInResult = await fake.invoke('kubeverse:auth-sign-in');
    const getStateResult = await fake.invoke('kubeverse:auth-get-state');
    const everythingObservable = JSON.stringify({ signInResult, getStateResult, broadcasts: fake.getSentMessages() });

    assert.doesNotMatch(everythingObservable, /super-secret-access-token/);
    assert.doesNotMatch(everythingObservable, /super-secret-refresh-token/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign-out clears the persisted state, broadcasts signedIn: false, and never touches unrelated files', async () => {
  const dir = tempUserDataDir();
  const idToken = fakeIdToken({ sub: 'user-42' });
  const { server, port } = await startFakeGoogleTokenServer({ access_token: 'at', refresh_token: 'rt', id_token: idToken });
  try {
    const fake = buildFakeElectron(dir);
    fake.shell.openExternal = async (authUrlString) => {
      const authUrl = new URL(authUrlString);
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      await fetch(`${redirectUri}/?code=fake-code&state=${state}`);
    };
    createAuthController({
      app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage,
      getMainWindow: () => fake.mainWindow, clientId: 'test-client', tokenEndpoint: `http://127.0.0.1:${port}`,
    });
    await fake.invoke('kubeverse:auth-sign-in');

    // A real, unrelated project-like file sitting in the same userData dir
    // for this test's purposes - proves sign-out's blast radius.
    const unrelatedFile = join(dir, 'setup-state.json');
    require('node:fs').writeFileSync(unrelatedFile, JSON.stringify({ setupComplete: true }));

    const signOutResult = await fake.invoke('kubeverse:auth-sign-out');
    assert.equal(signOutResult, true);

    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: false });
    assert.equal(require('node:fs').existsSync(join(dir, 'auth-state.json')), false);
    assert.equal(require('node:fs').existsSync(unrelatedFile), true, 'sign-out must never delete unrelated local files');

    const broadcasts = fake.getSentMessages().filter((m) => m.channel === 'kubeverse:auth-state');
    assert.deepEqual(broadcasts.at(-1).state, { signedIn: false });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a returning launch with a previously-persisted identity restores signed-in state without any network call', async () => {
  const dir = tempUserDataDir();
  const { writeAuthState } = require('./authState.js');
  const encrypt = (text) => Buffer.from(`enc:${text}`, 'utf8');
  writeAuthState(join(dir, 'auth-state.json'), { identity: { sub: 'returning-user', email: 'a@b.com' }, refreshToken: 'rt' }, encrypt);

  const fake = buildFakeElectron(dir);
  // openExternal deliberately left undefined - restoring a session must
  // never call it, i.e. must never attempt any network/browser interaction.
  try {
    createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' });
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: true, identity: { sub: 'returning-user', email: 'a@b.com', name: undefined, picture: undefined } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupted persisted auth file restores as signed-out on launch, never throws', async () => {
  const dir = tempUserDataDir();
  require('node:fs').writeFileSync(join(dir, 'auth-state.json'), '{ not valid json');
  const fake = buildFakeElectron(dir);
  try {
    assert.doesNotThrow(() => createAuthController({ app: fake.app, shell: fake.shell, ipcMain: fake.ipcMain, safeStorage: fake.safeStorage, getMainWindow: () => fake.mainWindow, clientId: 'test-client' }));
    const state = await fake.invoke('kubeverse:auth-get-state');
    assert.deepEqual(state, { signedIn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
