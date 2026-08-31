// Pure decision/formatting logic for the Google identity UI (AccountMenu.tsx,
// OnboardingView.tsx's identity step), factored out for the same reason
// updateLogic.ts is: authController.js (the real implementation) can only
// run inside a real Electron main process, so the UI's *reaction* to a given
// auth state is ordinary, pure, testable logic instead.
//
// Phase 6: identity is now brokered through Firebase Authentication (see
// desktop/src/firebaseAuth.js) - `uid` is the Firebase UID (Identity
// Toolkit's `localId`), the stable internal account identifier, never
// email (a user's Google account email can change; their Firebase UID for
// that account never does).
export interface GoogleIdentity {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

// Explicit states, matching authController.js's own AuthState shape exactly
// so both sides of the IPC boundary agree on vocabulary. 'loading' exists
// specifically so a UI reading this never has to guess/flash a wrong
// initial state before the real local answer is known - the same bug class
// OnboardingView.tsx's own three-state (undefined/true/false) setupComplete
// gating already exists to avoid. 'error' is a real, testable state here
// (AccountMenu.tsx layers it on top of its own local component state after
// a failed sign-in attempt) even though authController.js's own broadcast
// channel deliberately never gets stuck on it - see authController.js's own
// comment for why a failed/cancelled sign-in returns cleanly to signed_out
// there instead.
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; identity: GoogleIdentity }
  | { status: 'error'; message: string };

export type SignInResult = { success: true; identity: GoogleIdentity } | { success: false; error: string };

// Never the raw Firebase uid (an opaque id string) - name, then email, then
// a generic fallback, matching how TopBar.tsx already treats the local
// installation id as a quiet technical detail, not the primary label a user
// reads.
export function displayName(identity: GoogleIdentity): string {
  return identity.name || identity.email || 'Signed in';
}

// A single-letter/two-letter avatar fallback for when no profile picture is
// available (or hasn't loaded yet) - derived only from name/email, never
// from `uid`.
export function initials(identity: GoogleIdentity): string {
  const source = identity.name || identity.email || '?';
  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return letters || '?';
}

export function signInButtonLabel(busy: boolean): string {
  return busy ? 'Opening Google sign-in…' : 'Continue with Google';
}

// Phase 7: what the top-bar account area renders for a given auth state -
// factored out of AccountMenu.tsx for the same reason every other function
// in this file is: a pure decision, testable without a DOM/component-render
// harness (this project has never needed one - see updateLogic.ts for the
// same pattern applied to the update banner). 'hidden' covers 'loading'
// only (never flash a wrong initial state, matching OnboardingView.tsx's own
// three-state setupComplete gating); 'signed-out' covers both 'signed_out'
// and 'error' - a failed/cancelled sign-in attempt still shows the same
// compact "Sign in" trigger (AccountMenu.tsx layers the actual error message
// into that trigger's own popover via its local component state), never a
// distinct fourth top-bar treatment.
export type AccountAreaMode = 'hidden' | 'signed-out' | 'signed-in';

export function accountAreaMode(state: AuthState): AccountAreaMode {
  if (state.status === 'loading') return 'hidden';
  if (state.status === 'signed_in') return 'signed-in';
  return 'signed-out';
}
