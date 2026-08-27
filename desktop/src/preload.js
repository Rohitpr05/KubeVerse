// Runs in an isolated context with Node access, before the renderer's own
// scripts (Electron's standard contextBridge pattern - Phase 3, §9/§22).
// Exposes only narrow, typed operations - never raw Node/fs/shell access to
// the renderer, and never electron-updater itself:
//   - isDesktop: a plain boolean marker so the shared React app can tell
//     "am I running inside the desktop shell" (gates the first-launch
//     checklist and the update banner - browser dev mode never shows
//     either) without any privileged capability at all.
//   - getSetupComplete/setSetupComplete: the *only* way the renderer can
//     read or write the local first-launch completion flag (Phase 3, §6) -
//     backed by a small JSON file in the OS-appropriate app-data directory
//     (desktop/src/setupState.js), written only by the main process via
//     these two narrow IPC handlers (see main.js), never a direct
//     filesystem API handed to the renderer.
//   - checkForUpdates/downloadUpdate/quitAndInstall/getUpdateState/
//     onUpdateState: the *only* surface for the Phase 3B auto-updater
//     (desktop/src/updater.js) - a real download or restart-to-install only
//     ever happens because the renderer explicitly called one of these in
//     response to the user's own click, never automatically from here.
//   - signInWithGoogle/signOut/getAuthState/onAuthState: the *only* surface
//     for the Phase 5 Google identity flow (desktop/src/authController.js).
//     The renderer never receives an OAuth access/refresh token, a client
//     secret, or any Node/shell/filesystem capability through this - only
//     the minimal identity object (sub/email/name/picture) and a signedIn
//     boolean, exactly as returned by authController.js's own IPC handlers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kubeverseDesktop', {
  isDesktop: true,
  getSetupComplete: () => ipcRenderer.invoke('kubeverse:get-setup-complete'),
  setSetupComplete: () => ipcRenderer.invoke('kubeverse:set-setup-complete'),

  checkForUpdates: () => ipcRenderer.invoke('kubeverse:check-for-updates'),
  getUpdateState: () => ipcRenderer.invoke('kubeverse:get-update-state'),
  downloadUpdate: () => ipcRenderer.invoke('kubeverse:download-update'),
  quitAndInstall: () => ipcRenderer.invoke('kubeverse:quit-and-install'),
  // Push notifications from the main process (autoUpdater's own real events,
  // relayed by updater.js) - onUpdateState returns an unsubscribe function,
  // the standard contextBridge-safe pattern for an event listener (raw
  // ipcRenderer.on/removeListener are not themselves exposed).
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kubeverse:update-state', listener);
    return () => ipcRenderer.removeListener('kubeverse:update-state', listener);
  },

  signInWithGoogle: () => ipcRenderer.invoke('kubeverse:auth-sign-in'),
  signOutOfGoogle: () => ipcRenderer.invoke('kubeverse:auth-sign-out'),
  getAuthState: () => ipcRenderer.invoke('kubeverse:auth-get-state'),
  onAuthState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kubeverse:auth-state', listener);
    return () => ipcRenderer.removeListener('kubeverse:auth-state', listener);
  },
});
