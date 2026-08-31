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
});

// Phase 7: Windows' report of a generic (Notes/document-style) installed-app
// icon led to inspecting BrowserWindow's own icon option specifically for
// Windows - electron-builder's win/nsis config (already asserted above) only
// covers the installer/.exe/shortcut metadata baked in at build time via
// rcedit, not the *running window's own* icon, which is this same
// X11/Wayland-motivated `icon:` option from a different angle: on Windows it
// should be a real multi-resolution .ico (Electron's own guidance), not the
// PNG that's correct for Linux. Both branches are asserted so this can't
// silently regress to PNG-on-Windows or ico-on-Linux.
test('main.js picks a real, bundled-resource icon path for both packaged and dev builds, .ico on Windows and .png elsewhere', () => {
  const source = readFileSync(join(root, 'desktop', 'src', 'main.js'), 'utf8');
  assert.match(
    source,
    /icon:\s*app\.isPackaged\s*\n?\s*\?\s*join\(process\.resourcesPath,\s*process\.platform\s*===\s*['"]win32['"]\s*\?\s*['"]icon\.ico['"]\s*:\s*['"]icon\.png['"]\)/,
    'expected a real, platform-appropriate bundled-resource icon path for packaged builds (.ico on win32, .png elsewhere)',
  );
  assert.match(
    source,
    /:\s*join\(__dirname,\s*['"]\.\.['"],\s*['"]build['"],\s*process\.platform\s*===\s*['"]win32['"]\s*\?\s*['"]icon\.ico['"]\s*:\s*['"]icon\.png['"]\)/,
    'expected the same platform-appropriate icon file in dev mode',
  );
});

test('the packaged icon.png is actually bundled into the app via extraResources, not just referenced', () => {
  const entry = desktopPkg.build.extraResources.find((resource) => resource.to === 'icon.png');
  assert.ok(entry, 'expected an extraResources entry copying an icon into the packaged app (to: "icon.png")');
  assert.equal(entry.from, 'build/icon.png');
});

test('the packaged icon.ico is actually bundled into the app via extraResources too, not just referenced by win/nsis config', () => {
  const entry = desktopPkg.build.extraResources.find((resource) => resource.to === 'icon.ico');
  assert.ok(entry, 'expected an extraResources entry copying icon.ico into the packaged app (to: "icon.ico") - otherwise main.js\'s own Windows icon: option would point at a file that does not exist at runtime');
  assert.equal(entry.from, 'build/icon.ico');
});

test('the icon.ico is a real, valid multi-resolution Windows icon - not an empty/placeholder/renamed file', () => {
  const bytes = readFileSync(join(buildDir, 'icon.ico'));
  // ICO header: reserved(0)=0, type(2)=1 (icon), count(2)>=1 real entries.
  assert.equal(bytes.readUInt16LE(0), 0, 'ICO reserved field must be 0');
  assert.equal(bytes.readUInt16LE(2), 1, 'ICO type field must be 1 (icon, not cursor)');
  const count = bytes.readUInt16LE(4);
  assert.ok(count >= 1, 'expected at least one icon image entry');
  // Windows' own Start Menu/taskbar/high-DPI icon caches specifically need a
  // large (256x256, stored as 0x0 in the directory entry per the ICO spec's
  // byte-sized width/height fields) entry to look correct at every size -
  // a tiny icon.ico with only a 16x16 entry is exactly the kind of
  // "technically an .ico but effectively a generic-looking icon" file that
  // would reproduce this bug.
  let has256 = false;
  for (let i = 0; i < count; i += 1) {
    const entryOffset = 6 + i * 16;
    const width = bytes.readUInt8(entryOffset);
    const height = bytes.readUInt8(entryOffset + 1);
    if (width === 0 && height === 0) has256 = true; // 0 encodes 256 in the ICO format
  }
  assert.ok(has256, 'expected a 256x256 entry in icon.ico for crisp Start Menu/high-DPI rendering');
});

// Investigated per the Phase 5 follow-up's request ("determine whether the
// current appId is stable and appropriate"): dev.kubeverse.desktop is a
// well-formed reverse-DNS id, unchanged since it was first set, and nothing
// found during this investigation implicated it in the gear-icon report -
// it is left as-is, not changed without a demonstrated reason.
test('appId is a stable, well-formed reverse-DNS identifier', () => {
  assert.equal(desktopPkg.build.appId, 'dev.kubeverse.desktop');
  assert.match(desktopPkg.build.appId, /^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'appId should be lowercase, dot-separated, reverse-DNS style');
});

// The real Linux runtime-identity chain (confirmed by directly extracting a
// real AppImage/.deb build and reading their actual generated .desktop
// files - not assumed): electron-builder's LinuxTargetHelper computes both
// the .desktop file's Name= and its StartupWMClass= from `desktopName`
// (minus the ".desktop" suffix) whenever `linux.syncDesktopName: true` -
// which must therefore agree with `productName`, since Electron's own
// runtime app identity (what a real running window's app_id/WM_CLASS
// actually is) comes from `productName`/`app.getName()`, not `desktopName`
// directly. If these three ever drifted apart, GNOME/any desktop
// environment's app_id-to-.desktop-file lookup - the actual mechanism that
// decides which icon a running window's dock entry shows - would silently
// stop matching, exactly the class of bug this whole investigation was
// about.
test('desktopName, productName, and syncDesktopName agree - the runtime window identity electron-builder\'s .desktop entry expects', () => {
  assert.equal(desktopPkg.build.linux.syncDesktopName, true);
  assert.equal(desktopPkg.desktopName, `${desktopPkg.productName}.desktop`);
  assert.equal(desktopPkg.build.productName, desktopPkg.productName);
});

test('both Linux packaging targets (AppImage and deb) are configured, so both packaging modes can be built and compared', () => {
  assert.deepEqual(desktopPkg.build.linux.target, ['AppImage', 'deb']);
});
