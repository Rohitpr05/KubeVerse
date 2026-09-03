// Thin helper around the narrow bridge desktop/src/preload.js exposes.
// Undefined in browser dev mode (no preload script runs there at all), so
// every function here degrades to "this isn't the desktop app" safely - the
// first-launch checklist (OnboardingView.tsx) and the update banner
// (UpdateBanner.tsx) are both gated on isDesktopApp() and simply never
// appear in a browser tab.
import type { UpdateState } from './updateLogic';
import type { AuthState, SignInResult } from './authLogic';

export interface KubeverseDesktopBridge {
  isDesktop: true;
  getSetupComplete: () => Promise<boolean>;
  setSetupComplete: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  signInWithGoogle: () => Promise<SignInResult>;
  signOutOfGoogle: () => Promise<boolean>;
  getAuthState: () => Promise<AuthState>;
  onAuthState: (callback: (state: AuthState) => void) => () => void;
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

// undefined in browser dev mode (no packaged app, nothing to report) -
// callers should fall back to a generic message rather than showing a
// fabricated version number.
export function getAppVersion(): Promise<string | undefined> {
  return window.kubeverseDesktop?.getAppVersion() ?? Promise.resolve(undefined);
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

// Google sign-in is desktop-only by design (KUBEVERSE_MASTER_SPEC.md,
// "Desktop OAuth architecture") - it needs the main process's loopback
// server, system-browser launch, and OS-native safeStorage, none of which
// exist in browser dev mode. Every function here degrades the same way the
// update-check functions above do: a safe no-op/signed-out default, never a
// thrown error, so callers never need their own isDesktopApp() branch.
export function signInWithGoogle(): Promise<SignInResult> {
  return window.kubeverseDesktop?.signInWithGoogle() ?? Promise.resolve({ success: false, error: 'Sign-in is only available in the desktop app.' });
}

export function signOutOfGoogle(): Promise<boolean> {
  return window.kubeverseDesktop?.signOutOfGoogle() ?? Promise.resolve(true);
}

export function getAuthState(): Promise<AuthState> {
  return window.kubeverseDesktop?.getAuthState() ?? Promise.resolve({ status: 'signed_out' });
}

export function onAuthState(callback: (state: AuthState) => void): () => void {
  return window.kubeverseDesktop?.onAuthState(callback) ?? (() => {});
}
