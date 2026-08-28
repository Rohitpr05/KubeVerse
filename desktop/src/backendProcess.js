// Backend process lifecycle for the desktop shell (Phase 3, §3). Pure,
// dependency-injected logic - no Electron APIs here - so it's directly
// unit-testable with node:test (see backendProcess.test.js) without needing
// a running Electron process.
const { createServer } = require('node:net');
const { spawn: nodeSpawn } = require('node:child_process');

// Same "ask the OS for a genuinely free port" technique already used by
// backend/src/generators/hostPort.ts (bind to port 0, read back whatever the
// OS assigned, release the probe socket) - the desktop app never assumes
// port 4000 (or any fixed port) is available, since another KubeVerse
// instance, a previous run's orphan, or an unrelated local service could
// already hold it (Phase 3, §3: "Do not assume port 4000 is permanently
// available").
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error('Could not determine an assigned port.'))));
    });
  });
}

// Polls a real readiness endpoint (backend/src/server.ts's /health, which
// only ever answers once Fastify has actually started listening) rather than
// guessing a fixed startup delay - "wait for a real readiness signal" (§3).
async function waitForHealth({ url, timeoutMs = 15_000, intervalMs = 150, fetchFn = fetch }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url);
      if (response.ok) return;
      lastError = new Error(`Backend responded with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms: ${lastError?.message ?? 'unknown error'}`);
}

// Spawns the backend as its own child process, tracked by this exact handle
// - the desktop app only ever terminates the ONE process it started itself
// (§3: "Do not kill unrelated Node processes"), never anything discovered by
// port/name matching.
function startBackendProcess({ entryPath, env, spawnFn = nodeSpawn }) {
  return spawnFn(process.execPath, [entryPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Builds the backend child's environment from the app's own process.env plus
// KubeVerse's own required overrides (PLATFORM_PORT, ELECTRON_RUN_AS_NODE,
// ...), with NODE_OPTIONS explicitly, unconditionally stripped first.
//
// The backend never needs NODE_OPTIONS - it's a fixed, known Fastify app
// with no special runtime-flag requirements - and inheriting whatever value
// happens to be set in the ambient environment the desktop app was launched
// from is untested, unpredictable behavior for a process KubeVerse fully
// controls. Investigated live (not assumed): a real packaged AppImage
// launched with NODE_OPTIONS set genuinely does NOT pass it through to this
// spawned child - checked directly via /proc/<pid>/environ on both the main
// process and the backend child, neither had it, because Electron's own
// native startup (electron/shell/common/node_bindings.cc) already strips an
// unsupported NODE_OPTIONS from its own process.env right after warning
// about it once, before any of this file's JS ever runs. This function
// removes it explicitly anyway, rather than silently depending on that
// upstream implementation detail (which this codebase doesn't control and
// isn't part of Electron's documented public API) continuing to behave the
// same way in a future Electron version.
function backendEnv(baseEnv, extra) {
  const { NODE_OPTIONS, ...rest } = baseEnv;
  return { ...rest, ...extra };
}

// Graceful-then-forceful shutdown of exactly the tracked child - never an
// orphan (§3: "Do not leave orphan KubeVerse backend processes behind").
// SIGTERM first (Fastify/Node's normal graceful-shutdown signal); if the
// process hasn't actually exited within `timeoutMs`, SIGKILL as a backstop
// so app quit is never blocked indefinitely by a hung backend.
function stopBackendProcess(child, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const onExit = () => { clearTimeout(killTimer); resolve(); };
    child.once('exit', onExit);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.kill('SIGTERM');
  });
}

module.exports = { getFreePort, waitForHealth, startBackendProcess, stopBackendProcess, backendEnv };
