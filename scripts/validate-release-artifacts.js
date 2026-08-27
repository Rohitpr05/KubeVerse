#!/usr/bin/env node
// Post-packaging sanity check for CI (Phase 3B, §7): confirms electron-builder
// actually produced the artifacts this platform is supposed to produce, that
// none of them are suspiciously empty, and that the real application version
// (desktop/package.json - see scripts/set-version.js) shows up in every
// filename, exactly as desktop/package.json's own artifactName template
// (`KubeVerse-${version}-${os}-${arch}.${ext}`) promises. Does not attempt to
// launch anything - Windows binaries can't run on the Linux runner that packages
// Linux, and vice versa; actually running the packaged app is covered
// separately (locally, for Linux - see RELEASING.md's verification steps).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const releaseDir = join(root, 'desktop', 'release');
const version = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')).version;

// electron-builder's own macro expansion (confirmed by reading
// node_modules/builder-util/out/arch.js and app-builder-lib's macroExpander.js
// directly, not guessed): ${os} is "linux"/"win" (Platform.buildConfigurationKey),
// ${arch} for x64 is "x86_64" for AppImage, "amd64" for .deb, and the bare
// "x64" for anything else (including NSIS's .exe).
const expectedByPlatform = {
  linux: [
    { label: 'AppImage', pattern: new RegExp(`^KubeVerse-${escapeRegExp(version)}-linux-x86_64\\.AppImage$`) },
    { label: 'deb', pattern: new RegExp(`^KubeVerse-${escapeRegExp(version)}-linux-amd64\\.deb$`) },
  ],
  win32: [
    { label: 'NSIS installer', pattern: new RegExp(`^KubeVerse-${escapeRegExp(version)}-win-x64\\.exe$`) },
  ],
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const expected = expectedByPlatform[process.platform];
if (!expected) {
  console.error(`No expected-artifact list defined for platform "${process.platform}".`);
  process.exit(1);
}

let entries;
try {
  entries = readdirSync(releaseDir);
} catch (error) {
  console.error(`Could not read ${releaseDir}: ${error.message}`);
  process.exit(1);
}

let failed = false;
for (const { label, pattern } of expected) {
  const match = entries.find((entry) => pattern.test(entry));
  if (!match) {
    console.error(`✕ ${label}: no file in ${releaseDir} matches ${pattern} (found: ${entries.join(', ') || '(empty)'})`);
    failed = true;
    continue;
  }
  const { size } = statSync(join(releaseDir, match));
  if (size <= 0) {
    console.error(`✕ ${label}: ${match} exists but is empty (0 bytes)`);
    failed = true;
    continue;
  }
  console.log(`✓ ${label}: ${match} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

if (failed) {
  console.error('\nArtifact validation failed.');
  process.exit(1);
}
console.log('\nAll expected artifacts present, non-empty, and correctly versioned.');
