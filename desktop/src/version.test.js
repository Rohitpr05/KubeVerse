// Regression coverage for Phase 3B's versioning strategy (§1): root
// package.json's "version" is the one authoritative source (see
// scripts/set-version.js, which is the only supported way to change any of
// these), and every other workspace package.json - plus the two internal
// "@kubeverse/shared" dependency pins that would otherwise silently go
// stale - must always match it exactly. desktop/package.json's own version
// is what electron-builder actually bakes into the AppImage/.deb/.exe/NSIS
// installer metadata and artifact filenames, so a drift here would ship
// mismatched version numbers to real users.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const rootPkg = require(join(root, 'package.json'));
const sharedPkg = require(join(root, 'shared', 'package.json'));
const backendPkg = require(join(root, 'backend', 'package.json'));
const frontendPkg = require(join(root, 'frontend', 'package.json'));
const desktopPkg = require(join(root, 'desktop', 'package.json'));

test('root package.json declares a real semver version - the authoritative source', () => {
  assert.match(rootPkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

test('every workspace package.json version matches root exactly', () => {
  assert.equal(sharedPkg.version, rootPkg.version, 'shared/package.json');
  assert.equal(backendPkg.version, rootPkg.version, 'backend/package.json');
  assert.equal(frontendPkg.version, rootPkg.version, 'frontend/package.json');
  assert.equal(desktopPkg.version, rootPkg.version, 'desktop/package.json');
});

test('desktop/package.json\'s electron-builder "build.productName"/"productName" fields agree - what electron-builder ships must match what Electron\'s own runtime (app.getPath) resolves', () => {
  assert.equal(desktopPkg.productName, desktopPkg.build.productName);
});

test('backend and frontend pin the exact same @kubeverse/shared version as shared\'s own package.json, never a stale one', () => {
  assert.equal(backendPkg.dependencies['@kubeverse/shared'], sharedPkg.version);
  assert.equal(frontendPkg.dependencies['@kubeverse/shared'], sharedPkg.version);
});

test('the electron-builder artifactName template includes ${version}, so packaged filenames always reflect the real version, never a hardcoded one', () => {
  assert.match(desktopPkg.build.artifactName, /\$\{version\}/);
});
