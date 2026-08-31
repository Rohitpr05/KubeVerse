#!/usr/bin/env node
// Stages a clean, production-only node_modules for the packaged backend
// bundle (Phase 3 packaging). Why this exists: backend's real npm
// dependencies (fastify, @kubernetes/client-node, ...) are installed at the
// MONOREPO ROOT (npm workspaces hoisting), not in backend/node_modules -
// there is no single real directory that already holds exactly what
// backend/dist/server.mjs needs at runtime and nothing else (the root
// node_modules also holds every frontend/desktop devDependency: Vite,
// TypeScript, Electron itself, ...). Packaging the whole root node_modules
// would ship hundreds of MB of build tooling inside the shipped app.
//
// This script installs a throwaway package.json - the same "dependencies"
// list backend/esbuild.config.js already treats as external (everything
// except @kubeverse/shared, which is bundled into server.mjs directly, not
// left as a runtime import) - into desktop/build/backend-deps/node_modules,
// with --omit=dev. desktop/package.json's "build.extraResources" then copies
// that directory alongside the built backend, instead of a path that
// doesn't exist as a real directory (../backend/node_modules).
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

// Windows has no bare "npm" executable on PATH, only "npm.cmd" - a batch
// file, not a real .exe. Since Node's CVE-2024-27980 fix (shipped in every
// Node 22.x release - confirmed live against the exact windows-latest
// release-job failure this resolves: `spawnSync npm.cmd` -> EINVAL,
// errno -4071), execFileSync/spawnSync on Windows refuse to launch a
// .bat/.cmd target at all unless `shell: true` is explicitly passed - a
// deliberate guardrail against a real command-injection vulnerability that
// used to exist in Node's own implicit shell hop for batch files, not a bug
// to route around. Opting into `shell: true` is safe specifically here
// because the install command below is a fixed, hardcoded literal argv -
// nothing derived from backend/package.json, an environment variable, or
// any other external input ever reaches it (dependency *names* only ever
// flow into the generated package.json file below via JSON.stringify, never
// into a command line), so there is no argument content for a shell to
// misinterpret. Linux's own `npm` is a real executable, not a batch file,
// and is entirely unaffected by any of this - its invocation is unchanged,
// and `shell` is never set for it.
function resolveNpmInvocation(platform = process.platform) {
  return platform === 'win32'
    ? { command: 'npm.cmd', options: { shell: true } }
    : { command: 'npm', options: {} };
}

function main() {
  const backendPkg = require('../../backend/package.json');
  const dependencies = Object.fromEntries(
    Object.entries(backendPkg.dependencies).filter(([name]) => name !== '@kubeverse/shared'),
  );

  // Deliberately NOT under desktop/build/ - that's electron-builder's own
  // "buildResources" convention (icons, etc.) and a stray backend-deps/
  // subfolder there could confuse it.
  const stagingDir = join(__dirname, '..', '.stage', 'backend-deps');
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'package.json'), JSON.stringify({ name: 'kubeverse-backend-deps', private: true, dependencies }, null, 2));

  console.log(`Installing ${Object.keys(dependencies).length} production backend dependencies into ${stagingDir} ...`);
  const { command, options } = resolveNpmInvocation();
  execFileSync(command, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stagingDir, stdio: 'inherit', ...options });
  console.log('Done.');
}

// Guarded so `resolveNpmInvocation` can be required and unit-tested (see
// prepare-backend-deps.test.js) without actually wiping desktop/.stage/ or
// running a real npm install as a side effect of merely requiring this file.
if (require.main === module) main();

module.exports = { resolveNpmInvocation };
