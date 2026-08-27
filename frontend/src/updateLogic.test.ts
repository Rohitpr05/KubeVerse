import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerMessage, bannerTitle, primaryAction, settingsStatusText, shouldShowBanner, type UpdateState } from './updateLogic.js';

// --- shouldShowBanner: silent unless there's something actionable ---

test('shouldShowBanner is false for idle/checking/not-available/error - a background check never interrupts the user', () => {
  const silentStates: UpdateState[] = [
    { status: 'idle' },
    { status: 'checking' },
    { status: 'not-available' },
    { status: 'error', message: 'offline' },
  ];
  for (const state of silentStates) assert.equal(shouldShowBanner(state), false, JSON.stringify(state));
});

test('shouldShowBanner is true once there is a real update available, downloading, or downloaded', () => {
  assert.equal(shouldShowBanner({ status: 'available', version: '3.1.0' }), true);
  assert.equal(shouldShowBanner({ status: 'downloading', percent: 40, bytesPerSecond: 100, transferred: 1, total: 2 }), true);
  assert.equal(shouldShowBanner({ status: 'downloaded', version: '3.1.0' }), true);
});

// --- bannerTitle / bannerMessage: real version numbers, real progress ---

test('an available update names the real version, not a generic message', () => {
  const state: UpdateState = { status: 'available', version: '3.1.0' };
  assert.equal(bannerTitle(state), 'New KubeVerse version available');
  assert.match(bannerMessage(state), /3\.1\.0/);
});

test('downloading shows the real percent, never a fabricated one', () => {
  const state: UpdateState = { status: 'downloading', percent: 42.7, bytesPerSecond: 2 * 1024 * 1024, transferred: 1, total: 2 };
  assert.match(bannerMessage(state), /43%|42%/); // Math.round(42.7) = 43
  assert.match(bannerMessage(state), /MB\/s/);
});

test('downloaded names the real version and tells the user a restart installs it', () => {
  const state: UpdateState = { status: 'downloaded', version: '3.1.0' };
  assert.equal(bannerTitle(state), 'Update ready');
  assert.match(bannerMessage(state), /3\.1\.0/);
  assert.match(bannerMessage(state), /[Rr]estart/);
});

// --- primaryAction: never both a download and install action at once ---

test('primaryAction is "download" only when available, "restart" only when downloaded, null otherwise', () => {
  assert.equal(primaryAction({ status: 'available', version: '3.1.0' }), 'download');
  assert.equal(primaryAction({ status: 'downloaded', version: '3.1.0' }), 'restart');
  assert.equal(primaryAction({ status: 'downloading', percent: 10, bytesPerSecond: 1, transferred: 1, total: 10 }), null);
  assert.equal(primaryAction({ status: 'checking' }), null);
  assert.equal(primaryAction({ status: 'not-available' }), null);
  assert.equal(primaryAction({ status: 'error', message: 'x' }), null);
  assert.equal(primaryAction({ status: 'idle' }), null);
});

// --- settingsStatusText: a manual check always shows something real,
// including the states the background banner deliberately hides ---

test('settingsStatusText covers every state distinctly, including the ones the banner hides', () => {
  const cases: [UpdateState, RegExp][] = [
    [{ status: 'idle' }, /not checked/i],
    [{ status: 'checking' }, /checking/i],
    [{ status: 'not-available' }, /up to date/i],
    [{ status: 'available', version: '3.1.0' }, /3\.1\.0/],
    [{ status: 'downloading', percent: 55, bytesPerSecond: 1, transferred: 1, total: 2 }, /55%/],
    [{ status: 'downloaded', version: '3.1.0' }, /3\.1\.0/],
    [{ status: 'error', message: 'offline' }, /offline/],
  ];
  for (const [state, pattern] of cases) assert.match(settingsStatusText(state), pattern, JSON.stringify(state));
});

// settingsStatusText is a dumb passthrough for state.message by design - the
// sanitizing (never raw HTTP/library dumps in front of a user) happens
// upstream in desktop/src/updater.js, not here, so this only needs to prove
// the message reaches the UI unmodified/unwrapped, not doubly-prefixed.
test('settingsStatusText renders state.message exactly as given, with no extra wrapping', () => {
  const text = settingsStatusText({ status: 'error', message: "Couldn't check for updates right now." });
  assert.equal(text, "Couldn't check for updates right now.");
});
