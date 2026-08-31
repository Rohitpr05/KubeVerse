// Regression coverage for a real CI bug: desktop/package.json's "package"
// script (what ci.yml's Package (ubuntu-latest)/Package (windows-latest)
// jobs run on every push/PR) used to call bare `electron-builder` with no
// explicit --publish flag. electron-builder's own implicit-publish
// auto-detection (ci-info's isCI, true on every GitHub Actions runner
// regardless of push/PR/tag) then set publish mode to "onTagOrDraft", which
// - for a "github" provider specifically - is not skipped just for lacking
// a tag, so electron-builder tried to construct a real GitHubPublisher and
// failed with "GitHub Personal Access Token is not set" - confirmed live
// against the actual failing GitHub Actions run logs for both platforms,
// not assumed. ci.yml deliberately has no `contents: write` permission and
// never sets GH_TOKEN (see ci.yml's own header comment) - the fix is not to
// give it one, but to make the "package" script's own intent (never
// publish) explicit, exactly as electron-builder's own deprecation warning
// recommends ("Please use --publish explicitly").
//
// "release" (what release.yml's tag-triggered job runs, with a real
// GH_TOKEN) was already explicit (--publish always) and was never affected
// by this bug - this file locks in that these two scripts can never
// silently drift back into the same publish behavior.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const desktopPkg = require(join(__dirname, '..', 'package.json'));

test('the "package" script (CI packaging, no GitHub token available) explicitly never publishes', () => {
  assert.match(
    desktopPkg.scripts.package,
    /--publish\s+never\b/,
    'CI packaging must never attempt to reach GitHub\'s publish API - it has no token and no contents:write permission (ci.yml)',
  );
});

test('the "release" script (tag-triggered, real GH_TOKEN available) still explicitly always publishes', () => {
  assert.match(
    desktopPkg.scripts.release,
    /--publish\s+always\b/,
    'the tag-triggered release workflow must keep actually publishing - this is the one place a real GitHub Release is meant to be created',
  );
});

test('"package" and "release" can never silently converge on the same publish behavior', () => {
  const packagePublishMode = desktopPkg.scripts.package.match(/--publish\s+(\S+)/)?.[1];
  const releasePublishMode = desktopPkg.scripts.release.match(/--publish\s+(\S+)/)?.[1];
  assert.ok(packagePublishMode, '"package" must declare an explicit --publish mode, not rely on electron-builder\'s implicit CI detection');
  assert.ok(releasePublishMode, '"release" must declare an explicit --publish mode');
  assert.notEqual(packagePublishMode, releasePublishMode, 'CI packaging and the real release must use different, deliberately distinct publish modes');
});

test('both scripts still run prepare-backend-deps first - this fix only adds an explicit publish flag, nothing else', () => {
  assert.match(desktopPkg.scripts.package, /^npm run prepare-backend-deps && electron-builder/);
  assert.match(desktopPkg.scripts.release, /^npm run prepare-backend-deps && electron-builder/);
});
