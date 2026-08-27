// Thin helper around the narrow bridge desktop/src/preload.js exposes.
// Undefined in browser dev mode (no preload script runs there at all), so
// every function here degrades to "this isn't the desktop app" safely - the
// first-launch checklist (OnboardingView.tsx) and the update banner
// (UpdateBanner.tsx) are both gated on isDesktopApp() and simply never
// appear in a browser tab.
import type { UpdateState } from './updateLogic';

export interface KubeverseDesktopBridge {
  isDesktop: true;
  getSetupComplete: () => Promise<boolean>;
  setSetupComplete: () => Promise<boolean>;
  checkForUpdates: () => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
}

declare global {
  interface Window {
    kubeverseDesktop?: KubeverseDesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.kubeverseDesktop?.isDesktop === true;
}

export function getSetupComplete(): Promise<boolean> {
  return window.kubeverseDesktop?.getSetupComplete() ?? Promise.resolve(true);
}

export function markSetupComplete(): Promise<boolean> {
  return window.kubeverseDesktop?.setSetupComplete() ?? Promise.resolve(true);
}

export function checkForUpdates(): Promise<void> {
  return window.kubeverseDesktop?.checkForUpdates() ?? Promise.resolve();
}

export function getUpdateState(): Promise<UpdateState> {
  return window.kubeverseDesktop?.getUpdateState() ?? Promise.resolve({ status: 'idle' });
}

export function downloadUpdate(): Promise<void> {
  return window.kubeverseDesktop?.downloadUpdate() ?? Promise.resolve();
}

export function quitAndInstall(): Promise<void> {
  return window.kubeverseDesktop?.quitAndInstall() ?? Promise.resolve();
}

// Returns a no-op unsubscribe in browser mode, so callers never need an
// isDesktopApp() check of their own before subscribing.
export function onUpdateState(callback: (state: UpdateState) => void): () => void {
  return window.kubeverseDesktop?.onUpdateState(callback) ?? (() => {});
}
