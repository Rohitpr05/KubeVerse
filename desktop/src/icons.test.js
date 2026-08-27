// Regression coverage for a real bug: the packaged Linux app showed
// Electron's own generic default icon in the window/taskbar instead of
// KubeVerse's, confirmed live. Root cause was two-fold - main.js passed
// `icon: undefined` to BrowserWindow whenever app.isPackaged was true (the
// icon file it wanted, build/icon.png, was never actually copied into the
// packaged app's resources) - both are covered here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const desktopPkg = require(join(root, 'desktop', 'package.json'));
const buildDir = join(root, 'desktop', 'build');

test('the real KubeVerse icon files exist on disk at the paths desktop/package.json configures', () => {
  assert.ok(existsSync(join(buildDir, 'icon.png')), 'desktop/build/icon.png must exist');
  assert.ok(existsSync(join(buildDir, 'icon.ico')), 'desktop/build/icon.ico must exist');
});

test('win/nsis/linux build config all point at the real build/icon.* files, not left unset (which would fall back to Electron\'s default)', () => {
  assert.equal(desktopPkg.build.win.icon, 'build/icon.ico');
  assert.equal(desktopPkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(desktopPkg.build.nsis.uninstallerIcon, 'build/icon.ico');
  assert.equal(desktopPkg.build.linux.icon, 'build/icon.png');
});

test('the icon.png is a real, substantial image - not an empty/placeholder file', () => {
  const bytes = readFileSync(join(buildDir, 'icon.png'));
  // A genuine 512x512 RGBA PNG is comfortably larger than a trivial/blank
  // placeholder would be; this is a coarse but real sanity check, not a
  // brittle byte-for-byte hash comparison against one exact source file.
  assert.ok(bytes.length > 5000, `icon.png is only ${bytes.length} bytes - looks like a placeholder, not a real icon`);
  // PNG magic bytes
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

// The actual bug: BrowserWindow's own `icon` option (what X11/Wayland show
// in the window title bar/taskbar, separate from what electron-builder bakes
// into the .desktop/exe metadata) was `undefined` whenever the app was
// packaged. main.js requires 'electron' at module scope, so it can only run
// inside a real Electron process (established pattern - see updater.js's own
// same constraint) - this asserts against the source text directly instead,
// as a regression guard against the exact broken pattern reappearing.
test('main.js never passes icon: undefined for a packaged build', () => {
  const source = readFileSync(join(root, 'desktop', 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(source, /icon:\s*app\.isPackaged\s*\?\s*undefined/, 'packaged builds must get a real icon path, not undefined');
  assert.match(source, /icon:\s*app\.isPackaged\s*\?\s*join\(process\.resourcesPath,\s*['"]icon\.png['"]\)/, 'expected a real bundled-resource icon path for packaged builds');
});

test('the packaged icon.png is actually bundled into the app via extraResources, not just referenced', () => {
  const entry = desktopPkg.build.extraResources.find((resource) => resource.to === 'icon.png');
  assert.ok(entry, 'expected an extraResources entry copying an icon into the packaged app (to: "icon.png")');
  assert.equal(entry.from, 'build/icon.png');
});
