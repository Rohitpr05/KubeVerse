import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./views/SettingsView.tsx', import.meta.url)), 'utf8');

// Regression test: the AI Provider card's API key description used to end
// with "A production desktop build will move this to OS keychain storage." -
// obsolete wording describing a PLANNED future change, not what the app
// actually does today. This repo has no React-render-testing setup (no
// @testing-library/react/jsdom - see frontend/package.json), so - matching
// trafficLayering.test.ts's own established pattern - this asserts against
// the real component source directly rather than a rendered DOM.
//
// The actual storage/transmission behavior (~/.kubeverse/settings.json,
// never sent to KubeVerse, only ever sent to the configured AI provider) is
// unchanged - backend/src/local/settings.ts is not touched by this fix, only
// this one sentence of UI copy.
test('the API key description no longer contains the obsolete OS-keychain sentence', () => {
  assert.doesNotMatch(source, /production desktop build will move this to OS keychain storage/);
});

test('the API key description still states exactly where/how the key is actually stored and used', () => {
  assert.match(source, /Your API key is stored locally on this machine, at <code>~\/\.kubeverse\/settings\.json<\/code>\. It is never committed to a project, never sent to KubeVerse, and only ever sent to the AI provider you configure here\./);
});

// Regression test: the Updates card used to always show a generic
// "KubeVerse is up to date." - now it names the real installed version
// (settingsStatusText's own currentVersion param, covered directly and
// thoroughly in updateLogic.test.ts) - this only proves SettingsView.tsx
// actually wires that real version through, not a hardcoded string.
test('the Updates card fetches the real installed app version and passes it into settingsStatusText, not a hardcoded string', () => {
  assert.match(source, /getAppVersion\(\)/, 'expected the real installed version to be fetched via desktop.ts\'s getAppVersion()');
  assert.match(source, /settingsStatusText\(updateState, appVersion\)/, 'expected the fetched version to actually reach settingsStatusText');
  // No literal version number anywhere in this file - it must always come
  // from the real bridge call, never be typed in by hand.
  assert.doesNotMatch(source, /\d+\.\d+\.\d+ is up to date/);
});
