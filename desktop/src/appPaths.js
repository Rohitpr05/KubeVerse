// OS-idiomatic local paths for the packaged desktop app (Phase 3, §5).
// Dev mode (`npm run dev`, `desktop:dev`) never imports this file - the
// backend keeps its own default (~/.kubeverse, ~/KubeVerse, from
// backend/src/local/paths.ts) completely untouched, so existing dev-mode
// projects/settings are never at risk from this change.
//
// Electron's app.getPath() already resolves the correct per-OS convention:
//   'userData'  -> %APPDATA%\KubeVerse (Windows), ~/.config/KubeVerse (Linux),
//                  ~/Library/Application Support/KubeVerse (macOS)
//   'documents' -> the user's real Documents folder on every OS
// Config/identity/settings are app state, so they get 'userData' - matching
// backend/src/local/paths.ts's own kubeverseHome() intent, just OS-correct
// instead of a hardcoded ~/.kubeverse. Projects are the user's own data, kept
// in a normal, visible, discoverable location (matching the existing
// projectsRoot() rationale) - "Documents/KubeVerse" is that location's
// correct per-OS equivalent.
//
// This does NOT migrate a user's existing ~/.kubeverse / ~/KubeVerse dev-mode
// data - that is a separate, explicit decision (see KUBEVERSE_MASTER_SPEC.md,
// "Desktop application (Phase 3)"), deliberately not built silently here.
const { join } = require('node:path');

function resolveAppPaths(app) {
  return {
    KUBEVERSE_HOME: join(app.getPath('userData'), 'config'),
    KUBEVERSE_PROJECTS_HOME: join(app.getPath('documents'), 'KubeVerse'),
  };
}

module.exports = { resolveAppPaths };
