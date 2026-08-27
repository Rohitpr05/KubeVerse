const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readSetupComplete, writeSetupComplete } = require('./setupState.js');

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-setup-state-'));
  return { dir, file: join(dir, 'setup-state.json') };
}

test('readSetupComplete is false when no file exists yet (a genuinely fresh install)', () => {
  const { dir, file } = tempFile();
  try {
    assert.equal(readSetupComplete(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSetupComplete(true) then readSetupComplete round-trips to true', () => {
  const { dir, file } = tempFile();
  try {
    writeSetupComplete(file, true);
    assert.equal(readSetupComplete(file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSetupComplete creates its parent directory if missing (a fresh userData dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kubeverse-setup-state-'));
  const file = join(dir, 'nested', 'deeper', 'setup-state.json');
  try {
    writeSetupComplete(file, true);
    assert.equal(readSetupComplete(file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt setup-state file is treated as "not complete", never throws', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, '{ not valid json');
    assert.equal(readSetupComplete(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSetupComplete is false for a well-formed file that just never set setupComplete:true', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, JSON.stringify({ somethingElse: true }));
    assert.equal(readSetupComplete(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
