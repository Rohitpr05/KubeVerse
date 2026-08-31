// Regression coverage for the Phase 7 auto-update lifecycle: a real,
// properly-anchored automatic background check (not the previous phase's
// blind `setTimeout(..., 5000)` from launch, and not the phase before that's
// full removal), plus the manual check/download/install flow it shares all
// of its machinery with. See main.js's own comment at the update-check call
// site for exactly what "properly anchored" means (loadURL()'s promise -
// a real did-finish-load signal - not a guess).
//
// Two layers are tested:
//   1. Unit-level, below: the controller's actual behavior - in-flight
//      duplicate-check/duplicate-download prevention, every real state
//      transition (available/downloading/downloaded/error) reaching the
//      renderer via the same broadcast path a real UpdateBanner listens on,
//      and that constructing the controller alone never itself triggers
//      anything. This requires faking out the real `electron-updater`
//      package first - `require('electron-updater')` eagerly touches
//      Electron's real `app` singleton the instant it's imported (confirmed
//      live: it throws "Cannot read properties of undefined (reading
//      'getVersion')" under plain `node --test`, since outside a real
//      Electron process `electron` resolves to a plain path string, not the
//      API). The fake is installed via require.cache, a standard Node
//      mocking technique - no application source was changed to make this
//      possible.
//   2. Source-level: main.js's actual entry point - the automatic check is
//      scheduled only for a real packaged build, only after the window has
//      genuinely finished loading, and is never awaited (so it can never
//      block startup) - the same source-inspection technique icons.test.js
//      and backendProcess.test.js already use elsewhere in this suite,
//      since main.js can only run inside a real Electron process too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// A real (if minimal) event emitter - not just a no-op `on()` - so tests
// below can fire the exact events electron-updater itself would, and prove
// the controller reacts to each one the way a real UpdateBanner depends on.
function fakeAutoUpdater() {
  const listeners = new Map();
  const calls = { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: 0 };
  let checkForUpdatesImpl = async () => { calls.checkForUpdates += 1; };
  let downloadUpdateImpl = async () => { calls.downloadUpdate += 1; };
  return {
    calls,
    logger: undefined,
    autoDownload: undefined,
    autoInstallOnAppQuit: undefined,
    on(event, fn) { (listeners.get(event) ?? listeners.set(event, []).get(event)).push(fn); return this; },
    emit(event, payload) { for (const fn of listeners.get(event) ?? []) fn(payload); },
    async checkForUpdates() { calls.checkForUpdates += 1; return checkForUpdatesImpl(); },
    async downloadUpdate() { calls.downloadUpdate += 1; return downloadUpdateImpl(); },
    quitAndInstall() { calls.quitAndInstall += 1; },
    // Test-only hooks so a single test can make one call hang (to exercise
    // the in-flight duplicate-call guards) or throw (to exercise error
    // handling) without affecting every other test sharing this module-level
    // fake.
    setCheckForUpdatesImpl(fn) { checkForUpdatesImpl = fn; },
    setDownloadUpdateImpl(fn) { downloadUpdateImpl = fn; },
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

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
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

test('the manual "check for updates" IPC channel still works, and no-ops cleanly in dev mode', async () => {
  const electron = fakeElectron({ isPackaged: false }); // dev/unpackaged - the real no-op path, no network reachable either way
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  assert.equal(typeof electron.handlers.get('kubeverse:check-for-updates'), 'function');
  await electron.handlers.get('kubeverse:check-for-updates')();
  const state = await electron.handlers.get('kubeverse:get-update-state')();
  assert.deepEqual(state, { status: 'not-available' }, 'a manual check still runs and resolves cleanly - unaffected by the automatic-trigger work');
});

test('every update IPC channel Settings/UpdateBanner depend on is still registered', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  for (const channel of ['kubeverse:check-for-updates', 'kubeverse:get-update-state', 'kubeverse:download-update', 'kubeverse:quit-and-install']) {
    assert.equal(typeof electron.handlers.get(channel), 'function', `${channel} should still be registered`);
  }
});

// Requirement: "Update available state is propagated to the UI" / "Download
// state is propagated" / "Ready to install state is propagated" - fired as
// real electron-updater events, exactly as the real library would, not
// asserted by calling some internal broadcast() directly.
test('a real "update-available" event reaches the renderer with the actual version, via the same channel UpdateBanner listens on', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  fake.emit('update-available', { version: '9.9.9' });
  assert.deepEqual(electron.sentMessages.at(-1), { channel: 'kubeverse:update-state', state: { status: 'available', version: '9.9.9' } });
});

test('real "download-progress" events reach the renderer with electron-updater\'s own real numbers, never fabricated ones', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  fake.emit('download-progress', { percent: 42.5, bytesPerSecond: 123456, transferred: 1000, total: 2000 });
  assert.deepEqual(electron.sentMessages.at(-1), {
    channel: 'kubeverse:update-state',
    state: { status: 'downloading', percent: 42.5, bytesPerSecond: 123456, transferred: 1000, total: 2000 },
  });
});

test('a real "update-downloaded" event reaches the renderer as a ready-to-install state', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  fake.emit('update-downloaded', { version: '9.9.9' });
  assert.deepEqual(electron.sentMessages.at(-1), { channel: 'kubeverse:update-state', state: { status: 'downloaded', version: '9.9.9' } });
});

// Requirement: "Update errors do not crash the application" / failure
// handling for GitHub-unavailable, malformed metadata, etc. - all surface
// through electron-updater's own 'error' event the same way, so one real
// error event exercises the same path a real network failure would.
test('a real electron-updater "error" event is sanitized before reaching the renderer, and never throws', () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  assert.doesNotThrow(() => fake.emit('error', new Error('HTTP 404: https://api.github.com/repos/x/y/releases/latest')));
  const last = electron.sentMessages.at(-1);
  assert.equal(last.state.status, 'error');
  assert.ok(typeof last.state.message === 'string' && last.state.message.length > 0);
});

test('checkForUpdates() itself never throws even when the underlying check rejects - the app must stay usable after a failed check', async () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  fake.setCheckForUpdatesImpl(async () => { throw new Error('network unreachable'); });
  try {
    await assert.doesNotReject(() => electron.handlers.get('kubeverse:check-for-updates')());
    const state = await electron.handlers.get('kubeverse:get-update-state')();
    assert.equal(state.status, 'error');
  } finally {
    fake.setCheckForUpdatesImpl(async () => {});
  }
});

// Requirement: "Duplicate update checks/downloads are prevented where
// appropriate" - a second call landing while the first is still genuinely
// in flight (not yet resolved) must not reach electron-updater a second
// time. Uses a real pending Promise (not a timer) so this is a real
// concurrency proof, not a timing-dependent guess.
test('a second checkForUpdates() call while one is still in flight is a no-op, not a second real check', async () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  const first = deferred();
  fake.setCheckForUpdatesImpl(() => first.promise);
  const before = fake.calls.checkForUpdates;

  const call1 = electron.handlers.get('kubeverse:check-for-updates')(); // starts, hangs on first.promise
  const call2 = electron.handlers.get('kubeverse:check-for-updates')(); // must see "already in flight" and return immediately
  await call2;
  assert.equal(fake.calls.checkForUpdates, before + 1, 'the second concurrent call must not reach electron-updater again');

  first.resolve();
  await call1;
  fake.setCheckForUpdatesImpl(async () => {});

  // Now that the first check has finished, a genuinely new check is allowed.
  await electron.handlers.get('kubeverse:check-for-updates')();
  assert.equal(fake.calls.checkForUpdates, before + 2, 'a check after the previous one finished must run for real');
});

test('a second downloadUpdate() call while one is still in flight is a no-op, not a second real download', async () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  const first = deferred();
  fake.setDownloadUpdateImpl(() => first.promise);
  const before = fake.calls.downloadUpdate;

  const call1 = electron.handlers.get('kubeverse:download-update')();
  const call2 = electron.handlers.get('kubeverse:download-update')();
  await call2;
  assert.equal(fake.calls.downloadUpdate, before + 1, 'the second concurrent download call must not reach electron-updater again');

  first.resolve();
  await call1;
  fake.setDownloadUpdateImpl(async () => {});
});

// Requirement: "The update system does not automatically restart the
// application" - quitAndInstall must only ever be reachable through the
// one IPC channel the renderer's explicit "Restart and Update" click uses,
// never called by the controller itself (not from checkForUpdates, not from
// downloadUpdate, not from any event listener registered above).
test('quitAndInstall is never called except by the renderer\'s own explicit request', async () => {
  const electron = fakeElectron();
  createUpdateController({ app: electron.app, ipcMain: electron.ipcMain, getMainWindow: electron.getMainWindow });
  const before = fake.calls.quitAndInstall;

  await electron.handlers.get('kubeverse:check-for-updates')();
  fake.emit('update-available', { version: '9.9.9' });
  await electron.handlers.get('kubeverse:download-update')();
  fake.emit('update-downloaded', { version: '9.9.9' });
  assert.equal(fake.calls.quitAndInstall, before, 'nothing above should have restarted the app on its own');

  await electron.handlers.get('kubeverse:quit-and-install')();
  assert.equal(fake.calls.quitAndInstall, before + 1, 'the explicit IPC call is the only thing that should trigger it');
});

// --- Source-level: main.js's real automatic-check wiring ---

test('main.js schedules the automatic update check only for a real packaged build', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.match(
    source,
    /if\s*\(app\.isPackaged\)\s*\{\s*\n?\s*setTimeout\(\s*\(\)\s*=>\s*void updateController\.checkForUpdates\(\),\s*UPDATE_CHECK_DELAY_AFTER_READY_MS\)\.unref\(\);/,
    'the automatic check must be gated behind app.isPackaged at the call site, not rely only on a nested guard',
  );
});

test('main.js anchors the automatic check after loadURL() actually resolves - a real readiness signal, not a bare timer from launch', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  const loadUrlIndex = source.indexOf('await mainWindow.loadURL(targetUrl);');
  const scheduleIndex = source.indexOf('setTimeout(() => void updateController.checkForUpdates()');
  assert.ok(loadUrlIndex >= 0, 'expected to find the loadURL() call');
  assert.ok(scheduleIndex >= 0, 'expected to find the update-check schedule call');
  assert.ok(scheduleIndex > loadUrlIndex, 'the update check must be scheduled after loadURL() resolves, not before');
});

test('main.js never awaits the update check - it must not be able to block or delay startup', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /await\s+updateController\.checkForUpdates\(\)/,
    'the automatic update check must be fire-and-forget (void + setTimeout(...).unref()), never awaited in the startup path',
  );
});

test('main.js still wires up the update controller, so the manual "Check for Updates" button keeps working', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.match(
    source,
    /createUpdateController\(/,
    'the update controller (and its IPC handlers) must still be created',
  );
});

test('the update-check delay is a real, named, documented constant - not a magic number inlined at the call site', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  assert.match(source, /const UPDATE_CHECK_DELAY_AFTER_READY_MS = \d+;/);
});

// Requirement: "Platform-specific update behavior is handled honestly" - the
// documented claim that Windows self-updates without an elevation prompt
// depends specifically on electron-builder's NSIS defaults (perMachine:
// false, a current-user install) staying as they are; this ties that claim
// to the actual config so a silent config change can't quietly invalidate
// documentation that was true when written. (Linux AppImage vs .deb are not
// asserted here the same way, since that difference comes from
// electron-updater's own Linux target detection, not a KubeVerse config
// value there is anything to regression-test against.)
test('the Windows NSIS config is still a current-user (non-elevated) install, matching the documented no-prompt self-update behavior', () => {
  const desktopPkg = require(join(__dirname, '..', 'package.json'));
  assert.notEqual(desktopPkg.build.nsis.perMachine, true, 'a per-machine NSIS install requires admin elevation, which would silently break the documented seamless Windows self-update flow');
});
