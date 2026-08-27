// Pure selectors deciding which topology nodes an active Lab experiment
// should visually call out - factored out of PlaygroundView.tsx so the
// targeting logic (which Pod gets which treatment, and when it stops) is
// independently testable without mounting React Flow.
import type { LabExperiment } from '@kubeverse/shared';

export function nodeKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}:${namespace ?? ''}:${name}`;
}

function isLive(experiment: LabExperiment | undefined): boolean {
  return experiment?.status === 'preparing' || experiment?.status === 'running';
}

// The generic amber "experiment target" ring (UX refinement, Part 10): the
// experiment's own target (a Deployment, for restart/scale) plus whichever
// Pod its most recent transition naming a *different* Pod refers to - in
// practice, the replacement Pod, the moment Kubernetes actually reports it,
// never before. Deliberately only the most recent one, not every distinct
// Pod ever mentioned, since the backend tracks transitions per-ReplicaSet
// (backend/src/lab/experiments.ts) and an unrelated sibling Pod reporting an
// incidental status blip during the same window would otherwise light up
// too. Excludes 'traffic' (already visualized by traffic particles) and
// 'pod-failure' (has its own, more specific treatment - see failingPodKey).
export function highlightedKeysFor(experiment: LabExperiment | undefined): Set<string> | null {
  if (!experiment || !isLive(experiment) || experiment.kind === 'traffic' || experiment.kind === 'pod-failure') return null;
  const keys = new Set<string>();
  keys.add(nodeKey(experiment.target.kind, experiment.target.namespace, experiment.target.name));
  for (let i = experiment.transitions.length - 1; i >= 0; i -= 1) {
    const transition = experiment.transitions[i];
    if (transition.kind === 'Pod' && transition.name !== experiment.target.name) {
      keys.add(nodeKey('Pod', experiment.target.namespace, transition.name));
      break;
    }
  }
  return keys;
}

// The Pod Failure visual lifecycle's target: always exactly the ORIGINAL Pod
// the experiment named, by name - never re-derived from transitions, so it
// can never drift onto the replacement Pod the ReplicaSet creates (that Pod
// should just appear like any other healthy node, per the real Pending ->
// Running -> Ready progression Kubernetes reports for it). Live for exactly
// as long as the real experiment is preparing/running, a real Kubernetes
// lifecycle signal - not a frontend countdown - so it clears the instant the
// experiment stops being live for any reason (converged, failed, cancelled,
// or no longer the active experiment at all, e.g. after a project switch
// resets `experiments`/`activeExperimentId`).
export function failingPodKeyFor(experiment: LabExperiment | undefined): string | undefined {
  if (!experiment || !isLive(experiment) || experiment.kind !== 'pod-failure') return undefined;
  return nodeKey('Pod', experiment.target.namespace, experiment.target.name);
}
