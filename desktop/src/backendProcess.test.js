const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { getFreePort, waitForHealth, startBackendProcess, stopBackendProcess } = require('./backendProcess.js');

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('getFreePort returns a real, currently-bindable port', async () => {
  const port = await getFreePort();
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536);
  const server = await listenOn(port);
  await close(server);
});

test('getFreePort never returns a port that is genuinely already in use', async () => {
  const held = await listenOn(0);
  const heldPort = held.address().port;
  try {
    for (let i = 0; i < 10; i += 1) assert.notEqual(await getFreePort(), heldPort);
  } finally {
    await close(held);
  }
});

// --- waitForHealth ---

test('waitForHealth resolves as soon as the injected fetch reports ok:true, without waiting out the full timeout', async () => {
  const start = Date.now();
  await waitForHealth({ url: 'http://127.0.0.1:0/health', timeoutMs: 5000, intervalMs: 50, fetchFn: async () => ({ ok: true, status: 200 }) });
  assert.ok(Date.now() - start < 500, 'should resolve almost immediately, not wait out the interval/timeout');
});

test('waitForHealth retries through failures and eventually succeeds once the backend becomes ready', async () => {
  let calls = 0;
  await waitForHealth({
    url: 'http://127.0.0.1:0/health', timeoutMs: 5000, intervalMs: 10,
    fetchFn: async () => { calls += 1; if (calls < 3) throw new Error('ECONNREFUSED'); return { ok: true, status: 200 }; },
  });
  assert.equal(calls, 3);
});

test('waitForHealth throws a descriptive error if the backend never becomes ready within the timeout - it does not hang forever or silently succeed', async () => {
  await assert.rejects(
    () => waitForHealth({ url: 'http://127.0.0.1:0/health', timeoutMs: 200, intervalMs: 20, fetchFn: async () => { throw new Error('ECONNREFUSED'); } }),
    /did not become ready/,
  );
});

// --- start/stop process lifecycle (against a REAL child process, not a fake) ---

test('startBackendProcess invokes the injected spawnFn with the current node executable and the given entry path', () => {
  let capturedArgs;
  const fakeChild = { fake: true };
  const result = startBackendProcess({
    entryPath: '/path/to/server.mjs',
    env: { KUBEVERSE_HOME: '/tmp/x' },
    spawnFn: (...args) => { capturedArgs = args; return fakeChild; },
  });
  assert.equal(result, fakeChild);
  const [command, args, options] = capturedArgs;
  assert.equal(command, process.execPath);
  assert.deepEqual(args, ['/path/to/server.mjs']);
  assert.equal(options.env.KUBEVERSE_HOME, '/tmp/x');
});

test('startBackendProcess spawns a genuinely real, running child process end to end (no injected spawnFn)', async () => {
  // A trivial real script in place of the real backend entry - this exercises
  // the actual node:child_process.spawn default, not a fake.
  const script = '/tmp/kubeverse-desktop-test-entry.mjs';
  await (await import('node:fs/promises')).writeFile(script, 'setInterval(() => {}, 1000);');
  const child = startBackendProcess({ entryPath: script, env: { ...process.env } });
  try {
    await new Promise((resolve) => child.once('spawn', resolve));
    assert.equal(typeof child.pid, 'number');
    assert.ok(child.pid > 0);
  } finally {
    await stopBackendProcess(child, { timeoutMs: 2000 });
    await (await import('node:fs/promises')).unlink(script).catch(() => {});
  }
});

test('stopBackendProcess actually terminates a real running child process', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await new Promise((resolve) => child.once('spawn', resolve));
  assert.equal(child.exitCode, null, 'the process must genuinely be running before we stop it');

  await stopBackendProcess(child, { timeoutMs: 2000 });
  assert.notEqual(child.exitCode ?? child.signalCode, null, 'the process must have actually exited');
});

test('stopBackendProcess resolves immediately (does not hang) for a process that already exited', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => child.once('exit', resolve));
  const start = Date.now();
  await stopBackendProcess(child, { timeoutMs: 5000 });
  assert.ok(Date.now() - start < 200, 'must not wait out the timeout for an already-exited process');
});

test('stopBackendProcess falls back to SIGKILL if the process ignores SIGTERM, rather than hanging indefinitely', async () => {
  const { spawn } = await import('node:child_process');
  // Ignores SIGTERM on purpose, to exercise the SIGKILL backstop. Prints a
  // line once the handler is actually registered - waited on below - rather
  // than racing a guessed delay against the child's own startup time (the
  // 'spawn' event only means the OS successfully forked/exec'd it, not that
  // its own JS has run yet).
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)']);
  await new Promise((resolve) => child.stdout.once('data', resolve));

  const start = Date.now();
  await stopBackendProcess(child, { timeoutMs: 500 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 500 && elapsed < 3000, `expected the SIGKILL backstop around 500ms, took ${elapsed}ms`);
  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
