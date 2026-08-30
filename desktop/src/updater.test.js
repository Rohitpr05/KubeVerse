// Regression coverage for the "no automatic update check on launch"
// decision: the full auto-update system (automatic checks, update UX
// polish, a supported release cadence to check against) is deliberately
// deferred to a later phase - a packaged build must never make an
// unattended GitHub request just because it launched. The update machinery
// itself (this controller, its IPC channels, Settings' manual "Check for
// Updates" button) stays fully functional; only the automatic trigger that
// used to live in main.js's createWindow() is gone.
//
// Two layers are tested:
//   1. Unit-level, below: creating the controller alone never triggers a
//      check, and the manual IPC channel still works end to end. This
//      requires faking out the real `electron-updater` package first -
//      `require('electron-updater')` eagerly touches Electron's real `app`
//      singleton the instant it's imported (confirmed live: it throws
//      "Cannot read properties of undefined (reading 'getVersion')" under
//      plain `node --test`, since outside a real Electron process `electron`
//      resolves to a plain path string, not the API) - so updater.js could
//      never be require()'d directly in this test suite before. The fake is
//      installed via require.cache, a standard Node mocking technique - no
//      application source was changed to make this possible.
//   2. Source-level: main.js's actual entry point no longer contains the
//      automatic setTimeout(...checkForUpdates()) call, while still wiring
//      up the controller (so the manual channel stays registered) - the
//      same source-inspection technique icons.test.js and version.test.js
//      already use elsewhere in this suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function fakeAutoUpdater() {
  const calls = { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: 0 };
  return {
    calls,
    logger: undefined,
    autoDownload: undefined,
    autoInstallOnAppQuit: undefined,
    on() { return this; },
    async checkForUpdates() { calls.checkForUpdates += 1; },
    async downloadUpdate() { calls.downloadUpdate += 1; },
    quitAndInstall() { calls.quitAndInstall += 1; },
  };
}

// Installed once, before the first require('./updater.js') anywhere in this
// file - Node resolves and caches modules by absolute path, so updater.js's
// own `require('electron-updater')` picks up this fake instead of the real
// package for the rest of this test file's process.
const electronUpdaterPath = require.resolve('electron-updater');
const fake = fakeAutoUpdater();
require.cache[electronUpdaterPath] = { id: electronUpdaterPath, filename: electronUpdaterPath, loaded: true, exports: { autoUpdater: fake } };
const { createUpdateController } = require('./updater.js');

function fakeElectron({ isPackaged = true } = {}) {
  const handlers = new Map();
  const sentMessages = [];
  return {
    app: { isPackaged },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, state) => sentMessages.push({ channel, state }) },
    }),
    handlers,
    sentMessages,
  };
}

test('creating the update controller does not, by itself, trigger any update check or broadcast', async () => {
  const before = fake.calls.checkForUpdates;
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  // No IPC call was made yet - just constructing the controller (exactly
  // what main.js does unconditionally at module scope) must not itself
  // reach electron-updater/GitHub.
  assert.equal(fake.calls.checkForUpdates, before, 'checkForUpdates() must not run just from constructing the controller');
  assert.deepEqual(electron.sentMessages, []);
  const state = await electron.handlers.get('kubeverse:get-update-state')();
  assert.deepEqual(state, { status: 'idle' }, 'no check has run - state is still the untouched initial value');
});

test('the manual "check for updates" IPC channel is still registered and functions correctly', async () => {
  const electron = fakeElectron({ isPackaged: false }); // dev/unpackaged - the real no-op path, no network reachable either way
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  assert.equal(typeof electron.handlers.get('kubeverse:check-for-updates'), 'function');
  await electron.handlers.get('kubeverse:check-for-updates')();
  const state = await electron.handlers.get('kubeverse:get-update-state')();
  assert.deepEqual(state, { status: 'not-available' }, 'a manual check still runs and resolves cleanly - only the automatic launch trigger was removed, not the feature itself');
});

test('every update IPC channel Settings/UpdateBanner depend on is still registered', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  for (const channel of ['kubeverse:check-for-updates', 'kubeverse:get-update-state', 'kubeverse:download-update', 'kubeverse:quit-and-install']) {
    assert.equal(typeof electron.handlers.get(channel), 'function', `${channel} should still be registered`);
  }
});

test('main.js no longer schedules an automatic update check on launch', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /setTimeout\([^)]*checkForUpdates/s,
    'a packaged build must not automatically call checkForUpdates() shortly after launch',
  );
});

test('main.js still wires up the update controller, so the manual "Check for Updates" button keeps working', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.match(
    source,
    /createUpdateController\(/,
    'the update controller (and its IPC handlers) must still be created, even though the automatic trigger is gone',
  );
});
