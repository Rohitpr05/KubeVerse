// KubeVerse desktop shell main process (Phase 3). Owns exactly one thing the
// browser dev workflow doesn't need to: the local backend process's
// lifecycle. Everything else - the React UI, the Fastify API, Docker/
// Kubernetes access - is the existing, unmodified KubeVerse application;
// this file only starts it, waits for it to be genuinely ready, points a
// window at it, and cleanly stops it again.
// CommonJS deliberately (see desktop/package.json's "description") - only
// require()'d from inside a real Electron process resolves 'electron' to the
// actual app/BrowserWindow API; under Node's own ESM loader it resolves to
// the plain npm package instead, which only exports the path to the
// electron binary (for spawning it externally), leaving app/BrowserWindow
// undefined.
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const { getFreePort, waitForHealth, startBackendProcess, stopBackendProcess } = require('./backendProcess.js');
const { resolveAppPaths } = require('./appPaths.js');

// Electron's own built-in "am I running from source (`electron .`) vs a
// packaged/installed build" signal - true whenever `desktop:dev` launches
// this (alongside `npm run dev` for the backend/frontend workspaces via
// concurrently), false for a real packaged app. No separate custom env var
// needed, and it works identically on every OS (a hand-rolled env var would
// need something like cross-env to set portably from the root npm script -
// an extra dependency for something Electron already tells us). In dev mode
// this file never spawns a backend itself (one is already starting via
// `tsx watch`) and loads the Vite dev server instead of a built bundle, for
// the same hot-reload workflow the browser dev mode already has (Phase 3, §2).
const DEV_MODE = !app.isPackaged;
const DEV_BACKEND_URL = 'http://127.0.0.1:4000';
const DEV_FRONTEND_URL = 'http://127.0.0.1:5173';

let backendChild;
let mainWindow;

// Never two KubeVerse desktop instances contending for the same project
// files / spawning a second backend (Phase 3, §3). The loser quits
// immediately; the existing instance's window is focused instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(main).catch((error) => {
    console.error('KubeVerse desktop failed to start:', error);
    app.quit();
  });
}

async function main() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'KubeVerse',
    show: false,
    webPreferences: {
      // No Node/filesystem/shell access in the renderer (Phase 3, §9) - the
      // renderer only ever talks to the local backend over plain HTTP/SSE,
      // exactly like the browser dev workflow already does. There is
      // currently nothing privileged the renderer needs from a preload
      // bridge, so preload.js exists but intentionally exposes nothing yet.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });

  await mainWindow.loadFile(join(__dirname, 'loading.html'));

  try {
    const targetUrl = DEV_MODE ? await waitForDevServers() : await startProductionBackend();
    await mainWindow.loadURL(targetUrl);
  } catch (error) {
    console.error('KubeVerse backend failed to start:', error);
    await showStartupError(String(error?.message ?? error));
  }
}

async function waitForDevServers() {
  await waitForHealth({ url: `${DEV_BACKEND_URL}/health`, timeoutMs: 30_000 });
  await waitForHealth({ url: DEV_FRONTEND_URL, timeoutMs: 30_000 });
  return DEV_FRONTEND_URL;
}

// Production/packaged mode: spawn the backend's own built bundle (see
// backend/esbuild.config.js) as a real child process, with OS-idiomatic
// local paths (appPaths.js) and a freshly-probed free port - never a
// hardcoded 4000, since another KubeVerse instance or an unrelated local
// service could already hold it (Phase 3, §3).
async function startProductionBackend() {
  const port = await getFreePort();
  const backendEntry = app.isPackaged
    ? join(process.resourcesPath, 'backend', 'server.mjs')
    : join(__dirname, '..', '..', 'backend', 'dist', 'server.mjs');
  const staticDir = app.isPackaged
    ? join(process.resourcesPath, 'frontend')
    : join(__dirname, '..', '..', 'frontend', 'dist');

  if (!existsSync(backendEntry)) {
    throw new Error(`Backend build not found at ${backendEntry}. Run "npm run build --workspace=@kubeverse/backend" first.`);
  }

  backendChild = startBackendProcess({
    entryPath: backendEntry,
    env: {
      ...process.env,
      // The child is spawned via process.execPath, which - inside a running
      // Electron app - IS the Electron binary, not a plain `node` executable.
      // ELECTRON_RUN_AS_NODE is Electron's own documented mechanism for
      // making that same binary behave as a plain Node runtime instead of
      // launching a second GUI app: without it, whether the child actually
      // runs the backend script or does something else is undocumented
      // heuristic behavior - confirmed to actually fail silently (no server,
      // no error, just a /health timeout) in a genuinely packaged build.
      ELECTRON_RUN_AS_NODE: '1',
      PLATFORM_PORT: String(port),
      PLATFORM_HOST: '127.0.0.1',
      PLATFORM_STATIC_DIR: staticDir,
      ...resolveAppPaths(app),
    },
  });
  backendChild.stdout?.on('data', (chunk) => process.stdout.write(`[backend] ${chunk}`));
  backendChild.stderr?.on('data', (chunk) => process.stderr.write(`[backend] ${chunk}`));
  backendChild.on('exit', (code, signal) => {
    // An unexpected exit *after* startup (Docker/Kubernetes going away does
    // NOT crash the backend - see kubernetes-observer.ts's reconnect loop -
    // so a real backend exit here means something actually fatal happened).
    if (code !== null && code !== 0) console.error(`KubeVerse backend exited unexpectedly (code ${code}, signal ${signal})`);
  });

  await waitForHealth({ url: `http://127.0.0.1:${port}/health`, timeoutMs: 20_000 });
  return `http://127.0.0.1:${port}/`;
}

async function showStartupError(message) {
  const html = `data:text/html,${encodeURIComponent(`<!doctype html><html><body style="background:#0b1220;color:#f1f5f9;font-family:system-ui,sans-serif;padding:48px;">
    <h1>KubeVerse could not start</h1>
    <p style="color:#fca5a5;">${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>
    <p>Check that nothing else is blocking startup and try relaunching KubeVerse.</p>
    </body></html>`)}`;
  await mainWindow?.loadURL(html);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Only ever stops the ONE backend process this app itself spawned - never a
// port/name-based search for "something on 4000" (Phase 3, §3: "Do not kill
// unrelated Node processes. Do not leave orphan KubeVerse backend processes
// behind.").
app.on('before-quit', async (event) => {
  if (!backendChild || backendChild.exitCode !== null) return;
  event.preventDefault();
  await stopBackendProcess(backendChild);
  backendChild = undefined;
  app.quit();
});
