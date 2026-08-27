// Auto-update controller (Phase 3B, §10/§11). Lives entirely in the main
// process - the renderer only ever sees a narrow, read-only state broadcast
// plus three explicit action calls (check/download/quit-and-install), all
// routed through preload.js's contextBridge, never direct access to
// electron-updater or the filesystem.
//
// electron-updater (not Electron's own built-in `autoUpdater` module, which
// only supports Squirrel-based macOS/Windows updates) was chosen because it
// already understands electron-builder's own NSIS/AppImage artifacts and the
// GitHub Releases provider out of the box - confirmed compatible with the
// installed electron-builder@26.15.3 by matching `builder-util-runtime`
// versions (both resolve 9.7.0) before installing, not guessed.
//
// autoDownload/autoInstallOnAppQuit are both false: nothing downloads or
// installs without the user explicitly clicking "Download Update" / "Restart
// and Update" in the renderer (§12 - "Do NOT force updates immediately...
// Do not silently restart").
const { autoUpdater } = require('electron-updater');
const { sanitizeUpdateError } = require('./sanitizeUpdateError.js');

function createUpdateController({ app, ipcMain, getMainWindow }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let latestState = { status: 'idle' };

  function broadcast(state) {
    latestState = state;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('kubeverse:update-state', state);
  }

  autoUpdater.on('checking-for-update', () => broadcast({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => broadcast({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => broadcast({ status: 'not-available' }));
  autoUpdater.on('download-progress', (progress) => broadcast({
    status: 'downloading',
    // Real numbers straight from electron-updater's own download tracking -
    // never a fabricated/simulated percentage (§13).
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ status: 'downloaded', version: info.version }));
  // Covers every real failure mode honestly, including "offline" and "this
  // repository has no published releases yet / is private" (§15/§16) -
  // never thrown further up, never crashes the app, never blocks startup.
  // The real error (which can be a raw multi-line HTTP/library dump -
  // confirmed live for a real "no GitHub release published yet" 404) is
  // logged in full here for debugging; only sanitizeUpdateError's clean,
  // generic sentence ever reaches the renderer.
  autoUpdater.on('error', (error) => {
    console.error('KubeVerse update check failed:', error);
    broadcast({ status: 'error', message: sanitizeUpdateError(error) });
  });

  async function checkForUpdates() {
    // Unpackaged (dev) runs have no update metadata and would just throw
    // "dev-app-update.yml" errors - never attempted (§14/§15).
    if (!app.isPackaged) { broadcast({ status: 'not-available' }); return; }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('KubeVerse update check failed:', error);
      broadcast({ status: 'error', message: sanitizeUpdateError(error) });
    }
  }

  ipcMain.handle('kubeverse:check-for-updates', () => checkForUpdates());
  ipcMain.handle('kubeverse:get-update-state', () => latestState);
  ipcMain.handle('kubeverse:download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('KubeVerse update download failed:', error);
      broadcast({ status: 'error', message: sanitizeUpdateError(error) });
    }
  });
  // The only IPC call that actually restarts the app - exclusively reachable
  // from the renderer's own explicit "Restart and Update" button click,
  // never triggered by this module on its own.
  ipcMain.handle('kubeverse:quit-and-install', () => autoUpdater.quitAndInstall());

  return { checkForUpdates };
}

module.exports = { createUpdateController };
