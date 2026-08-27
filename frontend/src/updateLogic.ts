// Pure decision logic for the update banner (UpdateBanner.tsx), factored out
// for the same reason onboardingLogic.ts is: this repo's frontend tests run
// under plain node:test, and `electron-updater` itself can only run inside a
// real Electron process (it touches `electron.app` at import time) - so the
// actual update *mechanism* (desktop/src/updater.js) is only verifiable live,
// but the UI's *reaction* to a given state is ordinary, pure, testable logic.
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

// A background, once-per-launch check is deliberately silent unless there is
// something actionable to show (§12: never nag; §15: a failed/offline check
// must never interrupt the user). "checking"/"not-available"/"error"/"idle"
// render nothing here - a manual "Check for Updates" click in Settings shows
// its own inline result instead (see SettingsView.tsx), so errors are never
// completely invisible, just never a global banner.
export function shouldShowBanner(state: UpdateState): boolean {
  return state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
}

export function bannerTitle(state: UpdateState): string {
  switch (state.status) {
    case 'available': return 'New KubeVerse version available';
    case 'downloading': return 'Downloading update…';
    case 'downloaded': return 'Update ready';
    default: return '';
  }
}

export function bannerMessage(state: UpdateState): string {
  switch (state.status) {
    case 'available': return `KubeVerse ${state.version} is available.`;
    case 'downloading': return `${Math.round(state.percent)}% (${formatBytesPerSecond(state.bytesPerSecond)})`;
    case 'downloaded': return `KubeVerse ${state.version} is ready. Restart KubeVerse to install the update.`;
    default: return '';
  }
}

// The one primary, real action the banner's main button performs for a given
// state - never both a download AND an install button at once, since only
// one is ever meaningful (§12's two-step "Download Update" then, after it
// finishes, "Restart and Update" flow).
export function primaryAction(state: UpdateState): 'download' | 'restart' | null {
  if (state.status === 'available') return 'download';
  if (state.status === 'downloaded') return 'restart';
  return null;
}

// Settings' own "Check for Updates" status line (SettingsView.tsx) - unlike
// the silent background banner, a manual check always shows *something*,
// including the otherwise-hidden states (checking/not-available/error), since
// the user explicitly asked (§14).
export function settingsStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'idle': return 'Not checked yet.';
    case 'checking': return 'Checking…';
    case 'not-available': return 'KubeVerse is up to date.';
    case 'available': return `KubeVerse ${state.version} is available.`;
    case 'downloading': return `Downloading ${Math.round(state.percent)}%…`;
    case 'downloaded': return `KubeVerse ${state.version} downloaded - restart to install.`;
    // state.message is already a clean, complete sentence by the time it
    // reaches here - desktop/src/updater.js sanitizes every real error
    // (which can otherwise be a raw HTTP/library dump - confirmed live
    // against a real "no GitHub release published yet" 404) before it's
    // ever broadcast to the renderer, so this never wraps/prefixes it.
    case 'error': return state.message;
  }
}

function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}
