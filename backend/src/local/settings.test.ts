import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// See workspace.test.ts for why KUBEVERSE_HOME must be set before the first
// import below.
const kubeverseHome = mkdtempSync(join(tmpdir(), 'kubeverse-settings-test-'));
process.env.KUBEVERSE_HOME = kubeverseHome;

const { readSettings, writeSettings, toPublicSettings, normalizeModel, DEFAULT_OPENROUTER_MODEL } = await import('./settings.js');

function settingsFilePath(): string {
  return join(kubeverseHome, 'settings.json');
}

function resetSettingsFile() {
  rmSync(settingsFilePath(), { force: true });
}

// --- normalizeModel: the one rule every layer (read, write, compile) applies ---

test('normalizeModel keeps a real custom model as-is', () => {
  assert.equal(normalizeModel('anthropic/claude-3.5-sonnet'), 'anthropic/claude-3.5-sonnet');
});

test('normalizeModel trims surrounding whitespace from a real model', () => {
  assert.equal(normalizeModel('  anthropic/claude-3.5-sonnet  '), 'anthropic/claude-3.5-sonnet');
});

test('normalizeModel resolves an empty string to the default', () => {
  assert.equal(normalizeModel(''), DEFAULT_OPENROUTER_MODEL);
});

test('normalizeModel resolves a whitespace-only string to the default', () => {
  assert.equal(normalizeModel('   '), DEFAULT_OPENROUTER_MODEL);
});

test('normalizeModel resolves undefined/null/non-string values to the default, without throwing', () => {
  assert.equal(normalizeModel(undefined), DEFAULT_OPENROUTER_MODEL);
  assert.equal(normalizeModel(null), DEFAULT_OPENROUTER_MODEL);
  assert.equal(normalizeModel(42), DEFAULT_OPENROUTER_MODEL);
  assert.equal(normalizeModel({}), DEFAULT_OPENROUTER_MODEL);
});

// --- readSettings: self-healing on every read ---

test('readSettings returns the real default model when no settings file exists yet (a fresh install)', () => {
  resetSettingsFile();
  assert.equal(readSettings().model, DEFAULT_OPENROUTER_MODEL);
});

// Regression test for the actual reported bug: a stored `model: ""` used to
// silently win over the default forever, because the key was *present* in
// the merged object (`{...defaults, ...parsed}`), just empty - every read
// returned an unusable model, and every AI Builder compile sent OpenRouter
// an empty "model" field, which OpenRouter rejects with "No models
// provided".
test('readSettings self-heals a persisted empty-string model back to the default - the actual "No models provided" bug', () => {
  writeFileSync(settingsFilePath(), JSON.stringify({ aiProvider: 'openrouter', model: '', apiKey: 'sk-or-real-key' }));
  const settings = readSettings();
  assert.equal(settings.model, DEFAULT_OPENROUTER_MODEL);
  assert.notEqual(settings.model, '');
});

test('readSettings self-heals a legacy settings file with no "model" key at all', () => {
  writeFileSync(settingsFilePath(), JSON.stringify({ aiProvider: 'openrouter', apiKey: 'sk-or-real-key' }));
  assert.equal(readSettings().model, DEFAULT_OPENROUTER_MODEL);
});

test('readSettings preserves a real, previously-saved custom model exactly', () => {
  writeFileSync(settingsFilePath(), JSON.stringify({ aiProvider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }));
  assert.equal(readSettings().model, 'anthropic/claude-3.5-sonnet');
});

test('readSettings never throws on a corrupt settings file, and still resolves a usable model', () => {
  writeFileSync(settingsFilePath(), '{ not valid json');
  assert.equal(readSettings().model, DEFAULT_OPENROUTER_MODEL);
});

// --- writeSettings: a blank model can never reach disk ---

test('writeSettings never persists an empty-string model - it resolves to the default before writing', () => {
  resetSettingsFile();
  const result = writeSettings({ aiProvider: 'openrouter', model: '', apiKey: 'sk-or-real-key' });
  assert.equal(result.model, DEFAULT_OPENROUTER_MODEL);
  const onDisk = JSON.parse(readFileSync(settingsFilePath(), 'utf8'));
  assert.equal(onDisk.model, DEFAULT_OPENROUTER_MODEL);
  assert.notEqual(onDisk.model, '');
});

test('writeSettings treats "clear the model field and save" as "use the default", not as a no-op', () => {
  resetSettingsFile();
  writeSettings({ model: 'anthropic/claude-3.5-sonnet' });
  const result = writeSettings({ model: '' });
  assert.equal(result.model, DEFAULT_OPENROUTER_MODEL);
});

test('writeSettings preserves the existing model when the patch does not mention it at all (e.g. saving only a new API key)', () => {
  resetSettingsFile();
  writeSettings({ model: 'anthropic/claude-3.5-sonnet' });
  const result = writeSettings({ apiKey: 'sk-or-new-key' });
  assert.equal(result.model, 'anthropic/claude-3.5-sonnet');
});

test('writeSettings accepts and persists a real custom model unchanged', () => {
  resetSettingsFile();
  const result = writeSettings({ model: 'google/gemini-2.5-pro' });
  assert.equal(result.model, 'google/gemini-2.5-pro');
});

// --- toPublicSettings: API key never exposed, real default always exposed ---

test('toPublicSettings never includes the API key, and always reports the real default model', () => {
  const publicSettings = toPublicSettings({ aiProvider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', apiKey: 'sk-or-super-secret' });
  assert.equal('apiKey' in publicSettings, false);
  assert.equal(publicSettings.hasApiKey, true);
  assert.equal(publicSettings.model, 'anthropic/claude-3.5-sonnet');
  assert.equal(publicSettings.defaultModel, DEFAULT_OPENROUTER_MODEL);
});

test('toPublicSettings reports hasApiKey: false and no leaked key when none is configured', () => {
  const publicSettings = toPublicSettings({ aiProvider: 'openrouter', model: DEFAULT_OPENROUTER_MODEL });
  assert.equal(publicSettings.hasApiKey, false);
  assert.equal(JSON.stringify(publicSettings).includes('sk-or'), false);
});
