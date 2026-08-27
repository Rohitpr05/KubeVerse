// Pure decision logic for the first-launch checklist (OnboardingView.tsx),
// factored out so it's directly unit-testable without a DOM/React renderer -
// this repo's frontend tests run under plain node:test (see graph.test.ts,
// trafficReadiness.test.ts, etc.), never a browser/jsdom harness.
export type CheckState = 'checking' | 'ok' | 'unavailable';

export interface Check {
  key: string;
  label: string;
  state: CheckState;
  detail?: string;
}

export const INITIAL_CHECKS: Check[] = [
  { key: 'backend', label: 'KubeVerse backend', state: 'checking' },
  { key: 'docker', label: 'Docker', state: 'checking' },
  { key: 'kubernetes', label: 'Kubernetes', state: 'checking' },
  { key: 'kubectl', label: 'kubectl', state: 'checking' },
];

export function allSettled(checks: Check[]): boolean {
  return checks.every((check) => check.state !== 'checking');
}

// The KubeVerse backend itself is the one non-optional dependency: without
// it there is no app to continue into (every other view's first fetch would
// just fail). Docker/Kubernetes/kubectl are deliberately non-blocking -
// Definition of Done: "do not block the entire application when only one
// optional dependency is unavailable" - a generated project's Docker/
// Kubernetes execution can wait until the user actually starts them.
export function canContinue(checks: Check[]): boolean {
  const backend = checks.find((check) => check.key === 'backend');
  return allSettled(checks) && backend?.state === 'ok';
}

export function continueLabel(checks: Check[]): 'Continue' | 'Continue Anyway' {
  return checks.some((check) => check.state === 'unavailable') ? 'Continue Anyway' : 'Continue';
}

export function explainFailure(key: string, detail: string | undefined): string {
  switch (key) {
    case 'docker':
      return `Not detected. KubeVerse needs Docker to run containerized projects. Start Docker and try again.${detail ? ` (${detail})` : ''}`;
    case 'kubernetes':
      return 'Your Kubernetes cluster is currently unavailable. Start or enable Kubernetes and try again.';
    case 'kubectl':
      return `kubectl is not available. Install kubectl to apply Kubernetes manifests from KubeVerse.${detail ? ` (${detail})` : ''}`;
    default:
      return detail ?? 'Unavailable.';
  }
}
