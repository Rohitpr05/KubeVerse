// Regression test for the Windows release-job failure fixed in
// desktop/scripts/prepare-backend-deps.js: `execFileSync('npm.cmd', ...)`
// without `shell: true` fails with EINVAL on every Node 22.x release, since
// Node's CVE-2024-27980 fix refuses to spawn a .bat/.cmd target without an
// explicit shell opt-in. This tests the actual decision function the script
// uses to choose its command/options - not source text - covering both
// platform branches, and asserting Linux's already-working invocation is
// byte-for-byte unchanged (no shell option at all, not even shell: false).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveNpmInvocation } = require('../scripts/prepare-backend-deps.js');

test('on win32, resolveNpmInvocation targets npm.cmd and explicitly opts into shell: true - required since Node\'s CVE-2024-27980 fix, or execFileSync throws EINVAL', () => {
  const { command, options } = resolveNpmInvocation('win32');
  assert.equal(command, 'npm.cmd');
  assert.deepEqual(options, { shell: true });
});

test('on every non-Windows platform, resolveNpmInvocation targets the real npm executable with no shell option at all - Linux\'s already-working invocation is unchanged', () => {
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    const { command, options } = resolveNpmInvocation(platform);
    assert.equal(command, 'npm', `platform=${platform}`);
    assert.deepEqual(options, {}, `platform=${platform} must never set shell:true - only Windows needs it`);
  }
});

test('resolveNpmInvocation defaults to the real process.platform when called with no argument, exactly like the script\'s own real call site does', () => {
  const { command, options } = resolveNpmInvocation();
  assert.equal(command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  assert.deepEqual(options, process.platform === 'win32' ? { shell: true } : {});
});

test('the argv passed to npm is unaffected by the platform - only the command name and shell option differ, never the arguments themselves', () => {
  // resolveNpmInvocation only ever returns {command, options} - the actual
  // install argv (['install', '--omit=dev', '--no-audit', '--no-fund']) is
  // a separate, completely hardcoded literal in main() itself, never
  // touched by this function - this locks in that the two concerns stay
  // separate, so a future change to one can't accidentally smuggle
  // platform-conditional behavior into the other.
  const win = resolveNpmInvocation('win32');
  const linux = resolveNpmInvocation('linux');
  assert.deepEqual(Object.keys(win).sort(), ['command', 'options']);
  assert.deepEqual(Object.keys(linux).sort(), ['command', 'options']);
});
