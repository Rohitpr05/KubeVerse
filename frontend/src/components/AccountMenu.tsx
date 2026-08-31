import { useEffect, useState } from 'react';
import { getAuthState, isDesktopApp, onAuthState, signInWithGoogle, signOutOfGoogle } from '../desktop';
import { accountAreaMode, displayName, initials, signInButtonLabel, type AuthState } from '../authLogic';
import { PopoverDropdown } from './PopoverDropdown';
import googleLogo from '../assets/google-g-logo-dark.svg';

// The KubeVerse "account area" (KUBEVERSE_MASTER_SPEC.md, "Account UI") -
// deliberately small: a signed-in indicator plus sign-out, or a compact
// "Sign in" trigger when signed out. Never a SaaS-style profile dashboard -
// Google identifies the user, nothing more, so there is nothing else to show
// here. Desktop-only (Google sign-in needs the main process's loopback
// server/system browser/safeStorage - see desktop.ts) - renders nothing at
// all in browser dev mode, matching UpdateBanner/OnboardingView's own
// isDesktopApp() gating.
//
// Phase 7: the signed-out state used to render a full "Continue with Google"
// button (logo + text) permanently in the top bar - a persistent branded CTA
// that competed with the rest of the toolbar for attention on every screen,
// even though sign-in is entirely optional (KUBEVERSE_MASTER_SPEC.md §6.2).
// The full "Continue with Google" action still exists and is unchanged in
// OnboardingView.tsx's own identity step - here it now lives inside a
// compact "Sign in" popover trigger (the same PopoverDropdown pattern
// already used for the signed-in state below), reachable but not
// permanently on display.
export function AccountMenu() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isDesktopApp()) return;
    void getAuthState().then(setState);
    return onAuthState(setState);
  }, []);

  if (!isDesktopApp()) return null;

  async function handleSignIn() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await signInWithGoogle();
      if (result.success) setState({ status: 'signed_in', identity: result.identity });
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOutOfGoogle();
    setState({ status: 'signed_out' });
  }

  const mode = accountAreaMode(state);
  if (mode === 'hidden') return null;

  if (mode === 'signed-out') {
    return (
      <PopoverDropdown label="Sign in">
        <div className="popover-section">
          <button type="button" className="account-signin" onClick={() => void handleSignIn()} disabled={busy}>
            <img src={googleLogo} alt="" width={18} height={18} className="account-signin-logo" aria-hidden="true" />
            {signInButtonLabel(busy)}
          </button>
          {error && <span className="account-error" role="alert">{error}</span>}
        </div>
      </PopoverDropdown>
    );
  }

  if (state.status !== 'signed_in') return null; // unreachable given accountAreaMode's own logic - narrows `state` for TypeScript below
  const { identity } = state;
  const label = (
    <span className="account-chip">
      {identity.picture
        ? <img src={identity.picture} alt="" width={20} height={20} className="account-avatar" referrerPolicy="no-referrer" />
        : <span className="account-avatar account-avatar-fallback" aria-hidden="true">{initials(identity)}</span>}
      <span className="account-name">{displayName(identity)}</span>
    </span>
  );

  return (
    <PopoverDropdown label={label} className="account-trigger">
      <div className="popover-section">
        <p className="muted">{identity.email ?? displayName(identity)}</p>
        <button type="button" onClick={() => void handleSignOut()}>Sign out</button>
      </div>
    </PopoverDropdown>
  );
}
