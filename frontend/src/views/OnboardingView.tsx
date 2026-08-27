import { useEffect, useState } from 'react';
import { api } from '../api';
import { markSetupComplete, signInWithGoogle } from '../desktop';
import kubeverseIcon from '../assets/kubeverse-icon-tile.svg';
import { displayName, signInButtonLabel, type GoogleIdentity } from '../authLogic';
import { allSettled, canContinue, continueLabel, explainFailure, INITIAL_CHECKS, type Check, type CheckState } from './onboardingLogic';

// First-launch environment checklist (Phase 3, §2) - desktop-only (gated by
// App.tsx's isDesktopApp() check; never shown in browser dev mode). Reuses
// the exact same real backend probes the rest of the app already relies on
// (/health, /api/environment, /ready) - no second environment-detection
// architecture, no fabricated progress. `docker`/`kubernetes`/`kubectl` are
// deliberately non-blocking (Definition of Done: "do not block the entire
// application when only one optional dependency is unavailable") - the
// user can always Continue Anyway and revisit Settings later once they've
// started Docker/Kubernetes.
export function OnboardingView({ onContinue }: { onContinue: () => void }) {
  const [checks, setChecks] = useState<Check[]>(INITIAL_CHECKS);
  const [runId, setRunId] = useState(0);
  const [continuing, setContinuing] = useState(false);
  // A second, later step (KUBEVERSE_MASTER_SPEC.md, "First launch /
  // onboarding" preferred flow: checks -> identity -> app) - never a second
  // onboarding *system*, just one more screen inside this same component,
  // reached only after the existing environment checklist is dismissed.
  // Google sign-in is optional here by design: "Skip for now" reaches the
  // exact same finishOnboarding() as a successful sign-in, since identity
  // only ever identifies the user - it never gates local functionality
  // (offline users literally cannot sign in, and the app must still launch).
  const [step, setStep] = useState<'environment' | 'identity'>('environment');
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string>();
  const [signedInAs, setSignedInAs] = useState<GoogleIdentity>();

  function setCheck(key: string, state: CheckState, detail?: string) {
    setChecks((current) => current.map((check) => (check.key === key ? { ...check, state, detail } : check)));
  }

  useEffect(() => {
    setChecks(INITIAL_CHECKS);

    void api.getHealth()
      .then(() => setCheck('backend', 'ok'))
      .catch((error) => setCheck('backend', 'unavailable', error instanceof Error ? error.message : String(error)));

    void api.getEnvironment()
      .then((environment) => {
        setCheck('docker', environment.docker.available ? 'ok' : 'unavailable', environment.docker.available ? environment.docker.version : environment.docker.error);
        setCheck('kubectl', environment.kubernetes.available ? 'ok' : 'unavailable', environment.kubernetes.available ? environment.kubernetes.context : environment.kubernetes.error);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setCheck('docker', 'unavailable', message);
        setCheck('kubectl', 'unavailable', message);
      });

    void api.getReady()
      .then((ready) => setCheck('kubernetes', ready.status === 'ready' ? 'ok' : 'unavailable'))
      .catch((error) => setCheck('kubernetes', 'unavailable', error instanceof Error ? error.message : String(error)));
  }, [runId]);

  const stillChecking = !allSettled(checks);
  const backend = checks.find((check) => check.key === 'backend')!;

  async function finishOnboarding() {
    setContinuing(true);
    try {
      await markSetupComplete();
      onContinue();
    } finally {
      setContinuing(false);
    }
  }

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setSignInError(undefined);
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        setSignedInAs(result.identity);
        await finishOnboarding();
      } else {
        setSignInError(result.error);
      }
    } finally {
      setSigningIn(false);
    }
  }

  if (step === 'identity') {
    return (
      <div className="onboarding-view">
        <div className="onboarding-card">
          <img src={kubeverseIcon} alt="" width={64} height={64} className="onboarding-logo" />
          <h1>KubeVerse</h1>
          <p className="onboarding-tagline">Sign in to identify yourself in KubeVerse</p>
          <p className="muted">
            This only identifies you - your projects, generated code, and API keys always stay on this machine.
            Google is never used to store or sync them.
          </p>

          {signedInAs && <p className="muted">Signed in as {displayName(signedInAs)}.</p>}
          {signInError && <p className="error onboarding-blocker" role="alert">{signInError}</p>}

          <div className="settings-actions onboarding-actions">
            <button onClick={() => void handleGoogleSignIn()} disabled={signingIn || continuing} className="onboarding-continue">
              {signInButtonLabel(signingIn)}
            </button>
            <button onClick={() => void finishOnboarding()} disabled={signingIn || continuing}>
              {continuing ? 'Continuing…' : 'Skip for now'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-view">
      <div className="onboarding-card">
        <img src={kubeverseIcon} alt="" width={64} height={64} className="onboarding-logo" />
        <h1>KubeVerse</h1>
        <p className="onboarding-tagline">Local Kubernetes Development Environment</p>
        <p className="muted">{stillChecking ? 'Checking your environment…' : 'Environment check complete.'}</p>

        <ul className="onboarding-checklist">
          {checks.map((check) => (
            <li key={check.key} className={`onboarding-check status-${check.state}`}>
              <span className="onboarding-check-icon" aria-hidden="true">
                {check.state === 'checking' ? '…' : check.state === 'ok' ? '✓' : '✕'}
              </span>
              <div className="onboarding-check-body">
                <span className="onboarding-check-label">{check.label}</span>
                {check.state === 'unavailable' && (
                  <span className="onboarding-check-detail">{explainFailure(check.key, check.detail)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="settings-actions onboarding-actions">
          <button onClick={() => setRunId((value) => value + 1)} disabled={stillChecking}>Retry checks</button>
          <button
            onClick={() => setStep('identity')}
            disabled={!canContinue(checks)}
            className="onboarding-continue"
          >
            {continueLabel(checks)}
          </button>
        </div>
        {backend.state === 'unavailable' && (
          <p className="error onboarding-blocker">KubeVerse's local service could not be reached. This usually resolves itself in a few seconds - use Retry checks above.</p>
        )}
      </div>
    </div>
  );
}
