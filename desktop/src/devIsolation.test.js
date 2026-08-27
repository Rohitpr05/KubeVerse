// Regression coverage for a real, confirmed issue: dev (`electron .`) and a
// packaged build both resolve app.getPath('userData') from the same app
// name ("KubeVerse", from package.json's productName) unless dev mode is
// explicitly given its own name - confirmed live: completing onboarding
// once during ordinary `desktop:dev` testing had already marked setup
// complete at ~/.config/KubeVerse/setup-state.json, the exact same path a
// real packaged first launch reads from. main.js requires 'electron' at
// module scope (can only run inside a real Electron process - see
// updater.js's own same constraint), so this checks the source text
// directly, matching icons.test.js's established pattern for this
// constraint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'main.js'), 'utf8');

test('dev mode gets its own distinct app name, set before any app.getPath() call', () => {
  assert.match(source, /if\s*\(!app\.isPackaged\)\s*app\.setName\(['"]KubeVerse-dev['"]\)/, 'expected an explicit app.setName(...) for unpackaged runs');
  const setNameIndex = source.indexOf('app.setName(');
  // Matched with the opening quote (app.getPath('...')) so this only finds
  // real invocations, not this file's own comments *describing* app.getPath().
  const firstGetPathCallIndex = source.search(/app\.getPath\(['"]/);
  assert.ok(setNameIndex >= 0, 'app.setName(...) call not found');
  assert.ok(firstGetPathCallIndex < 0 || setNameIndex < firstGetPathCallIndex, 'app.setName(...) must run before the first app.getPath(...) call - Electron does not re-resolve userData after a later rename');
});

test('a developer/test-only env var can reset onboarding without a visible production reset button', () => {
  assert.match(source, /KUBEVERSE_RESET_SETUP/);
  assert.doesNotMatch(source, /reset.*button/i, 'no visible reset button should be introduced in the production UI');
});
