// Short, human-readable explanations for the Kubernetes state transitions the
// Lab experiment tracker (experiments.ts) observes. This is the foundation
// referenced by KUBEVERSE_MASTER_SPEC.md's future learning engine (§12) -
// intentionally minimal here: one sentence per recognizable status/reason,
// looked up against data the observer already reports, never a full tutorial
// system. A transition with no match here just has no `explanation` - the
// timeline still shows the raw status, it just isn't annotated.
import type { ClusterKind } from '@kubeverse/shared';

const REASON_EXPLANATIONS: Record<string, string> = {
  FailedScheduling: 'The scheduler could not find a Node satisfying the Pod\'s requirements (often insufficient CPU/memory).',
  Scheduled: 'The scheduler assigned this Pod to a Node.',
  Pulling: 'The container runtime is pulling the container image.',
  Pulled: 'The container image is present on the Node and ready to run.',
  Created: 'The container was created on the Node.',
  Started: 'The container process has started.',
  BackOff: 'Kubernetes is waiting before retrying a failing operation, backing off to avoid a tight crash/restart loop.',
  Unhealthy: 'A liveness or readiness probe failed for this container.',
  Killing: 'Kubernetes is stopping this container/Pod.',
  SuccessfulCreate: 'The ReplicaSet created a new Pod to match its desired replica count.',
  SuccessfulDelete: 'The ReplicaSet deleted a Pod to match its desired replica count.',
  ScalingReplicaSet: 'The Deployment is changing the size of its ReplicaSet to match the desired replica count.',
};

const STATUS_EXPLANATIONS: Array<[RegExp, string]> = [
  [/^Pending$/, 'This Pod exists, but Kubernetes has not finished scheduling and starting it yet.'],
  [/\(Ready\)/, 'The Pod passed its readiness checks and can now receive traffic.'],
  [/^Running$/, 'The Pod\'s containers are running, but it has not (yet) passed a readiness check.'],
  [/CrashLoopBackOff/, 'A container keeps exiting shortly after starting; Kubernetes is backing off between restart attempts.'],
  [/ImagePullBackOff|ErrImagePull/, 'The container image could not be pulled (missing image, wrong tag, or no registry access).'],
  [/Failed/, 'This Pod failed to run to completion.'],
  [/Unknown/, 'Kubernetes has lost contact with the Node hosting this Pod, so its state cannot be confirmed.'],
];

// A ReplicaSet/Deployment's own transition, keyed on replica convergence
// rather than a status string - callers pass the transition's replica
// counts directly since "0/1 Ready" alone doesn't say whether it's growing,
// shrinking, or recovering.
export function replicaSetExplanation(desired: number, current: number, ready: number): string {
  if (ready < desired) return `The ReplicaSet is trying to make the actual number of Pods (${current}) match the desired replica count (${desired}).`;
  return `The ReplicaSet now has all ${desired} desired Pods ready.`;
}

export function explainStatus(kind: ClusterKind, status: string): string | undefined {
  if (kind === 'Pod') {
    for (const [pattern, explanation] of STATUS_EXPLANATIONS) if (pattern.test(status)) return explanation;
  }
  return undefined;
}

export function explainReason(reason: string | undefined): string | undefined {
  return reason ? REASON_EXPLANATIONS[reason] : undefined;
}
