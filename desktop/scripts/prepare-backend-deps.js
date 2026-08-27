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
// Windows has no bare "npm" executable on PATH, only "npm.cmd" - execFileSync
// (no shell) needs the real filename or it fails with ENOENT. This runs in
// CI on windows-latest (Phase 3B's packaging matrix), not just Linux.
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCommand, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stagingDir, stdio: 'inherit' });
console.log('Done.');
