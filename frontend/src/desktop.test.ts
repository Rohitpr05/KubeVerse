import { test } from 'node:test';
import assert from 'node:assert/strict';

// This project's frontend tests run under plain node:test (no jsdom/browser
// harness - see graph.test.ts, trafficReadiness.test.ts, etc.), so `window`
// doesn't exist by default. desktop.ts only ever touches
// `window.kubeverseDesktop` (never any other browser API), so a minimal
// stub is enough to exercise its real logic - both "browser dev mode"
// (no bridge at all) and "desktop app" (bridge present) are real scenarios
// this module must handle correctly.
// `await run()` here, not `return run()`: for a `run` callback that awaits
// more than once (several bridge calls in sequence), a bare `return run()`
// lets `finally` delete `window` the instant `run()` returns its *pending*
// promise - i.e. after its first `await` suspends, not after it actually
// finishes - so any bridge call after the first one inside `run` would read
// a `window` that's already been deleted out from under it.
async function withWindow<T>(kubeverseDesktop: unknown, run: () => Promise<T> | T): Promise<T> {
  (globalThis as { window?: unknown }).window = { kubeverseDesktop };
  try {
    return await run();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

test('isDesktopApp is false when there is no window at all (this module is imported in a non-browser context)', async () => {
  const { isDesktopApp } = await import('./desktop.js');
  delete (globalThis as { window?: unknown }).window;
  assert.equal(isDesktopApp(), false);
});

test('isDesktopApp is false in browser dev mode - no preload script ever ran, so window.kubeverseDesktop is undefined', async () => {
  const { isDesktopApp } = await import('./desktop.js');
  await withWindow(undefined, () => {
    assert.equal(isDesktopApp(), false);
  });
});

test('isDesktopApp is true once the desktop preload bridge is present', async () => {
  const { isDesktopApp } = await import('./desktop.js');
  await withWindow({ isDesktop: true, getSetupComplete: async () => true, setSetupComplete: async () => true }, () => {
    assert.equal(isDesktopApp(), true);
  });
});

test('getSetupComplete defaults to true (never shows onboarding) when there is no desktop bridge', async () => {
  const { getSetupComplete } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    assert.equal(await getSetupComplete(), true);
  });
});

test('getSetupComplete delegates to the real bridge call and returns its real (persisted) value when the bridge is present', async () => {
  const { getSetupComplete } = await import('./desktop.js');
  await withWindow({ isDesktop: true, getSetupComplete: async () => false, setSetupComplete: async () => true }, async () => {
    assert.equal(await getSetupComplete(), false);
  });
});

test('markSetupComplete delegates to the real bridge call when present', async () => {
  const { markSetupComplete } = await import('./desktop.js');
  let called = false;
  await withWindow({ isDesktop: true, getSetupComplete: async () => false, setSetupComplete: async () => { called = true; return true; } }, async () => {
    await markSetupComplete();
  });
  assert.equal(called, true);
});

test('markSetupComplete does not throw when there is no desktop bridge (browser dev mode)', async () => {
  const { markSetupComplete } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    await assert.doesNotReject(() => markSetupComplete());
  });
});

test('getAppVersion is undefined (never a fabricated version) when there is no desktop bridge', async () => {
  const { getAppVersion } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    assert.equal(await getAppVersion(), undefined);
  });
});

test('getAppVersion delegates to the real bridge call and returns its real (Electron app.getVersion()) value when present', async () => {
  const { getAppVersion } = await import('./desktop.js');
  await withWindow({ isDesktop: true, getSetupComplete: async () => true, setSetupComplete: async () => true, getAppVersion: async () => '4.3.3' }, async () => {
    assert.equal(await getAppVersion(), '4.3.3');
  });
});

// --- update bridge (Phase 3B) ---

function fakeBridge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isDesktop: true,
    getSetupComplete: async () => true,
    setSetupComplete: async () => true,
    getAppVersion: async () => '4.3.3',
    checkForUpdates: async () => {},
    getUpdateState: async () => ({ status: 'idle' }),
    downloadUpdate: async () => {},
    quitAndInstall: async () => {},
    onUpdateState: () => () => {},
    signInWithGoogle: async () => ({ success: true, identity: { uid: 'user-1' } }),
    signOutOfGoogle: async () => true,
    getAuthState: async () => ({ status: 'signed_out' }),
    onAuthState: () => () => {},
    ...overrides,
  };
}

test('getUpdateState defaults to {status:"idle"} when there is no desktop bridge', async () => {
  const { getUpdateState } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    assert.deepEqual(await getUpdateState(), { status: 'idle' });
  });
});

test('getUpdateState returns the real bridge value when present', async () => {
  const { getUpdateState } = await import('./desktop.js');
  await withWindow(fakeBridge({ getUpdateState: async () => ({ status: 'available', version: '3.1.0' }) }), async () => {
    assert.deepEqual(await getUpdateState(), { status: 'available', version: '3.1.0' });
  });
});

test('checkForUpdates/downloadUpdate/quitAndInstall all delegate to the real bridge calls when present', async () => {
  const called: string[] = [];
  const bridge = fakeBridge({
    checkForUpdates: async () => { called.push('check'); },
    downloadUpdate: async () => { called.push('download'); },
    quitAndInstall: async () => { called.push('install'); },
  });
  const { checkForUpdates, downloadUpdate, quitAndInstall } = await import('./desktop.js');
  await withWindow(bridge, async () => {
    await checkForUpdates();
    await downloadUpdate();
    await quitAndInstall();
  });
  assert.deepEqual(called, ['check', 'download', 'install']);
});

test('checkForUpdates/downloadUpdate/quitAndInstall never throw when there is no desktop bridge (browser dev mode)', async () => {
  const { checkForUpdates, downloadUpdate, quitAndInstall } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    await assert.doesNotReject(() => checkForUpdates());
    await assert.doesNotReject(() => downloadUpdate());
    await assert.doesNotReject(() => quitAndInstall());
  });
});

test('onUpdateState subscribes through the real bridge and returns its real unsubscribe function', async () => {
  let subscribedCallback: ((state: unknown) => void) | undefined;
  let unsubscribed = false;
  const bridge = fakeBridge({
    onUpdateState: (callback: (state: unknown) => void) => {
      subscribedCallback = callback;
      return () => { unsubscribed = true; };
    },
  });
  const { onUpdateState } = await import('./desktop.js');
  await withWindow(bridge, async () => {
    const received: unknown[] = [];
    const unsubscribe = onUpdateState((state) => received.push(state));
    subscribedCallback?.({ status: 'downloaded', version: '3.1.0' });
    assert.deepEqual(received, [{ status: 'downloaded', version: '3.1.0' }]);
    unsubscribe();
    assert.equal(unsubscribed, true);
  });
});

test('onUpdateState returns a harmless no-op unsubscribe when there is no desktop bridge', async () => {
  const { onUpdateState } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    const unsubscribe = onUpdateState(() => { throw new Error('must never be called in browser mode'); });
    assert.doesNotThrow(() => unsubscribe());
  });
});

// --- Google auth bridge (Phase 5) ---

test('signInWithGoogle delegates to the real bridge call and returns its real result when present', async () => {
  const { signInWithGoogle } = await import('./desktop.js');
  const identity = { uid: 'user-42', email: 'ada@example.com' };
  await withWindow(fakeBridge({ signInWithGoogle: async () => ({ success: true, identity }) }), async () => {
    assert.deepEqual(await signInWithGoogle(), { success: true, identity });
  });
});

test('signInWithGoogle returns a clear "desktop only" failure, never throws, when there is no desktop bridge (browser dev mode)', async () => {
  const { signInWithGoogle } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    const result = await signInWithGoogle();
    assert.equal(result.success, false);
  });
});

test('signOutOfGoogle delegates to the real bridge call when present', async () => {
  let called = false;
  const bridge = fakeBridge({ signOutOfGoogle: async () => { called = true; return true; } });
  const { signOutOfGoogle } = await import('./desktop.js');
  await withWindow(bridge, async () => { await signOutOfGoogle(); });
  assert.equal(called, true);
});

test('signOutOfGoogle does not throw when there is no desktop bridge', async () => {
  const { signOutOfGoogle } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    await assert.doesNotReject(() => signOutOfGoogle());
  });
});

test('getAuthState defaults to signed-out when there is no desktop bridge', async () => {
  const { getAuthState } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    assert.deepEqual(await getAuthState(), { status: 'signed_out' });
  });
});

test('getAuthState returns the real bridge value, including a real identity, when present', async () => {
  const identity = { uid: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace' };
  const { getAuthState } = await import('./desktop.js');
  await withWindow(fakeBridge({ getAuthState: async () => ({ status: 'signed_in', identity }) }), async () => {
    assert.deepEqual(await getAuthState(), { status: 'signed_in', identity });
  });
});

// Privacy proof at the bridge boundary: the bridge's real return value -
// exactly what the frontend ever sees - contains only identity fields,
// never a token, a project path, or an API key, even if a malicious/buggy
// main process tried to hand one over. This mirrors authController.test.js's
// same proof from the main-process side; this one proves the *frontend*
// never assumes/strips anything - it just relays whatever it's given, so
// the guarantee has to hold upstream (which authController.test.js verifies).
test('getAuthState never receives more than status + identity through the bridge contract', async () => {
  const identity = { uid: 'user-42', email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/a.jpg' };
  const { getAuthState } = await import('./desktop.js');
  await withWindow(fakeBridge({ getAuthState: async () => ({ status: 'signed_in', identity }) }), async () => {
    const state = await getAuthState();
    assert.deepEqual(Object.keys(state).sort(), ['identity', 'status']);
    if (state.status === 'signed_in') assert.deepEqual(Object.keys(state.identity).sort(), ['email', 'name', 'picture', 'uid']);
  });
});

test('onAuthState subscribes through the real bridge and returns its real unsubscribe function', async () => {
  let subscribedCallback: ((state: unknown) => void) | undefined;
  let unsubscribed = false;
  const bridge = fakeBridge({
    onAuthState: (callback: (state: unknown) => void) => {
      subscribedCallback = callback;
      return () => { unsubscribed = true; };
    },
  });
  const { onAuthState } = await import('./desktop.js');
  await withWindow(bridge, async () => {
    const received: unknown[] = [];
    const unsubscribe = onAuthState((state) => received.push(state));
    subscribedCallback?.({ status: 'signed_in', identity: { uid: 'user-1' } });
    assert.deepEqual(received, [{ status: 'signed_in', identity: { uid: 'user-1' } }]);
    unsubscribe();
    assert.equal(unsubscribed, true);
  });
});

test('onAuthState returns a harmless no-op unsubscribe when there is no desktop bridge', async () => {
  const { onAuthState } = await import('./desktop.js');
  await withWindow(undefined, async () => {
    const unsubscribe = onAuthState(() => { throw new Error('must never be called in browser mode'); });
    assert.doesNotThrow(() => unsubscribe());
  });
});
