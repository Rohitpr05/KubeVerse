#!/usr/bin/env node
// The single place KubeVerse's application version is bumped (Phase 3B,
// §1/§2). Root package.json's own "version" field is the one authoritative
// source; this script writes that SAME string into every other workspace's
// package.json ("version" is only meaningful to Electron/electron-builder
// on desktop/package.json specifically - the installer/AppImage/.deb/.exe
// metadata electron-builder produces is read directly from there - but
// keeping backend/frontend/shared in lockstep too avoids "unrelated
// versions across packages" ambiguity, and desktop/src/version.test.js
// verifies they never drift apart again).
//
// A targeted string replacement, not JSON.parse+stringify: every one of
// these package.json files (especially desktop/package.json's nested
// electron-builder "build" config) is hand-formatted, and re-serializing
// the whole object would blow that formatting away on every version bump,
// producing a noisy diff that obscures the one line that actually changed.
//
// Usage: node scripts/set-version.js 3.0.0  (documented in RELEASING.md)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/set-version.js <version>  (e.g. 3.0.0)');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`"${version}" doesn't look like a semver version (expected e.g. 3.0.0 or 3.0.0-beta.1).`);
  process.exit(1);
}

const root = join(__dirname, '..');
const packageFiles = ['package.json', 'shared/package.json', 'backend/package.json', 'frontend/package.json', 'desktop/package.json'];
const versionLine = /^(\s*)"version":\s*"[^"]*"(,?)\s*$/m;
const nameLine = /^(\s*"name":\s*"[^"]*",)\s*$/m;
// backend/frontend both depend on @kubeverse/shared by an exact pinned
// version, not a range (workspace-internal packages aren't published
// anywhere a semver range would resolve against) - that pin goes stale the
// moment shared's own version changes, which is exactly the kind of
// "unrelated versions across packages" this whole script exists to prevent.
const sharedDependencyLine = /^(\s*)"@kubeverse\/shared":\s*"[^"]*"(,?)\s*$/m;

for (const relativePath of packageFiles) {
  const path = join(root, relativePath);
  const contents = readFileSync(path, 'utf8');
  let next = versionLine.test(contents)
    ? contents.replace(versionLine, (_match, indent, trailingComma) => `${indent}"version": "${version}"${trailingComma}`)
    // package.json has no "version" field yet (root's, today) - insert one
    // right after "name", matching where every other package.json already
    // has it.
    : contents.replace(nameLine, (_match, nameLineText) => `${nameLineText}\n  "version": "${version}",`);
  next = next.replace(sharedDependencyLine, (_match, indent, trailingComma) => `${indent}"@kubeverse/shared": "${version}"${trailingComma}`);
  writeFileSync(path, next);
  console.log(`  ${relativePath} -> ${version}`);
}
console.log(`\nAll package.json files set to ${version}.`);
