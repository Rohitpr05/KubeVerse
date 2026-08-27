// Minimal local persistence for "has this installation already completed the
// first-launch environment checklist" (Phase 3, §6) - a single small JSON
// file in the desktop app's own OS-appropriate application-data directory
// (see appPaths.js/main.js: app.getPath('userData')), never a cloud
// database, Redis, or any remote service. Pure/file-path-injected, like
// backendProcess.js, so it's directly unit-testable without a running
// Electron process.
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

function readSetupComplete(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))?.setupComplete === true;
  } catch {
    // A corrupt file is treated the same as "not completed yet" - never
    // throws, and the next writeSetupComplete() call overwrites it cleanly.
    return false;
  }
}

function writeSetupComplete(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ setupComplete: Boolean(value), updatedAt: new Date().toISOString() }, null, 2));
}

module.exports = { readSetupComplete, writeSetupComplete };
