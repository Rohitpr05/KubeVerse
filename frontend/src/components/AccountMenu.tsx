import { useEffect, useState } from 'react';
import { getAuthState, isDesktopApp, onAuthState, signInWithGoogle, signOutOfGoogle } from '../desktop';
import { displayName, initials, signInButtonLabel, type AuthState } from '../authLogic';
import { PopoverDropdown } from './PopoverDropdown';

// The KubeVerse "account area" (KUBEVERSE_MASTER_SPEC.md, "Account UI") -
// deliberately small: a signed-in indicator plus sign-out, or a single
// "Continue with Google" action when signed out. Never a SaaS-style profile
// dashboard - Google identifies the user, nothing more, so there is nothing
// else to show here. Desktop-only (Google sign-in needs the main process's
// loopback server/system browser/safeStorage - see desktop.ts) - renders
// nothing at all in browser dev mode, matching UpdateBanner/OnboardingView's
// own isDesktopApp() gating.
export function AccountMenu() {
  const [state, setState] = useState<AuthState>({ signedIn: false });
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
      if (result.success) setState({ signedIn: true, identity: result.identity });
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOutOfGoogle();
    setState({ signedIn: false });
  }

  if (!state.signedIn) {
    return (
      <div className="account-menu">
        <button type="button" className="account-signin" onClick={() => void handleSignIn()} disabled={busy}>
          {signInButtonLabel(busy)}
        </button>
        {error && <span className="account-error" role="alert">{error}</span>}
      </div>
    );
  }

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
