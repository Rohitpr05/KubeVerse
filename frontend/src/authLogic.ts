// Pure decision/formatting logic for the Google identity UI (AccountMenu.tsx,
// OnboardingView.tsx's identity step), factored out for the same reason
// updateLogic.ts is: authController.js (the real implementation) can only
// run inside a real Electron main process, so the UI's *reaction* to a given
// auth state is ordinary, pure, testable logic instead.
export interface GoogleIdentity {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export type AuthState = { signedIn: false } | { signedIn: true; identity: GoogleIdentity };

export type SignInResult = { success: true; identity: GoogleIdentity } | { success: false; error: string };

// Never the raw Google "sub" (a long opaque numeric string) - name, then
// email, then a generic fallback, matching how TopBar.tsx already treats
// the local installation id as a quiet technical detail, not the primary
// label a user reads.
export function displayName(identity: GoogleIdentity): string {
  return identity.name || identity.email || 'Signed in';
}

// A single-letter/two-letter avatar fallback for when no profile picture is
// available (or hasn't loaded yet) - derived only from name/email, never
// from `sub`.
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
