// Determines whether a project's Service actually has a real, currently-Ready
// Kubernetes endpoint before the Playground's Traffic control is allowed to
// send anything - and, when it doesn't, explains *why* using the same real
// observed data the rest of the Playground already has (KubeVerse's Lab
// Controls "Traffic readiness" refinement).
//
// This is deliberately NOT a second state system: every input here already
// exists in PlaygroundView (the project-scoped `snapshot.resources`, the
// already-computed `resourceGraph`'s 'selects' edges - the exact same signal
// backend/src/routes/lab.ts's resolveReadyTargets uses to pick real traffic
// targets - and `snapshot.events`, the same real Kubernetes Events the Live
// Timeline already renders). Because it's a pure function of already-live,
// SSE-driven props, recomputing it on every render is what makes the
// Pending -> Ready transition happen automatically, with no polling and no
// page reload: whatever triggers PlaygroundView to re-render with fresh
// `resources`/`events` (a real 'cluster-update' SSE event) recomputes this
// too.
//
// A Docker container existing, a Deployment existing, or a ReplicaSet
// existing are NEVER treated as evidence of readiness here - only an actual
// Pod that Kubernetes' own Ready condition (the same one ClusterResource's
// `status` already encodes as the "(Ready)" suffix - see
// backend/src/cluster-state.ts's podStatus()) reports as Ready counts.
import type { ClusterResource, ResourceGraph, TimelineEvent } from '@kubeverse/shared';

export type TrafficReadinessKind = 'no-service' | 'no-pods' | 'pending' | 'not-ready' | 'failing' | 'ready';

export interface TrafficReadiness {
  kind: TrafficReadinessKind;
  // Short, compact, user-facing explanation - what the Traffic panel shows.
  message: string;
  // The raw signal the message was derived from (a container's waiting
  // reason, or a Kubernetes Event's message), for callers that want it -
  // never fabricated, always traceable back to something actually observed.
  detail?: string;
  readyPodCount: number;
  totalPodCount: number;
}

// Container `status` values cluster-state.ts's containers() helper reports
// for a waiting container - these are Kubernetes' own reason strings
// (`containerStatuses[].state.waiting.reason`), not invented here.
const FAILING_CONTAINER_STATUSES = new Set([
  'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull',
  'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError', 'InvalidImageName',
]);

function backingPods(service: ClusterResource, resources: ClusterResource[], graph: ResourceGraph | undefined): ClusterResource[] {
  if (!graph) return [];
  const resourceByUid = new Map(resources.map((resource) => [resource.uid, resource]));
  const podUids = graph.edges
    .filter((edge) => edge.relation === 'selects' && edge.source === service.uid)
    .map((edge) => edge.target);
  return podUids
    .map((uid) => resourceByUid.get(uid))
    .filter((resource): resource is ClusterResource => Boolean(resource && resource.kind === 'Pod'));
}

function mostRecentEventFor(events: TimelineEvent[], podNames: Set<string>, reasons: string[]): TimelineEvent | undefined {
  return events
    .filter((event) => event.involvedName && podNames.has(event.involvedName) && event.reason && reasons.includes(event.reason))
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))[0];
}

// Kubernetes Event messages are often long and technical (scheduler
// preemption details, retry counters). This pulls out the one clause a
// learner actually needs - it never invents a reason that isn't in the
// message; if none of the known patterns match, it falls back to the
// message's first clause (still real Kubernetes text, just trimmed).
function summarizeEventMessage(message: string): string {
  const insufficient = message.match(/Insufficient (\w+)/i);
  if (insufficient) return `Insufficient ${insufficient[1]}`;
  const untolerated = message.match(/had (?:taint|untolerated taint) \{?([^,}]+)\}?/i);
  if (untolerated) return `node taint: ${untolerated[1].trim()}`;
  const readiness = message.match(/Readiness probe failed:?\s*(.*)/i);
  if (readiness?.[1]) return `readiness probe failed (${readiness[1].split('\n')[0].slice(0, 80)})`;
  const firstClause = message.split(/[.:]/)[0].trim();
  return firstClause.length > 0 && firstClause.length <= 100 ? firstClause : message.slice(0, 100);
}

export function computeTrafficReadiness(
  service: ClusterResource | undefined,
  resources: ClusterResource[],
  graph: ResourceGraph | undefined,
  events: TimelineEvent[],
): TrafficReadiness {
  if (!service) {
    return { kind: 'no-service', message: 'Select a service to check readiness.', readyPodCount: 0, totalPodCount: 0 };
  }

  const pods = backingPods(service, resources, graph);
  const readyPods = pods.filter((pod) => pod.status.includes('(Ready)'));
  if (readyPods.length > 0) {
    return { kind: 'ready', message: 'Ready', readyPodCount: readyPods.length, totalPodCount: pods.length };
  }

  if (pods.length === 0) {
    return { kind: 'no-pods', message: 'Waiting for Pods to start…', readyPodCount: 0, totalPodCount: 0 };
  }

  const podNames = new Set(pods.map((pod) => pod.name));

  // Failing takes priority over "still starting" states - it's the most
  // actionable signal when several Pods are in different states at once.
  const failingPod = pods.find((pod) => pod.containers?.some((container) => FAILING_CONTAINER_STATUSES.has(container.status)));
  if (failingPod) {
    const badContainer = failingPod.containers!.find((container) => FAILING_CONTAINER_STATUSES.has(container.status))!;
    return {
      kind: 'failing',
      message: `Service is not ready — Pod ${failingPod.name} is ${badContainer.status}.`,
      detail: badContainer.status,
      readyPodCount: 0, totalPodCount: pods.length,
    };
  }

  const pendingPod = pods.find((pod) => pod.status === 'Pending');
  if (pendingPod) {
    const event = mostRecentEventFor(events, podNames, ['FailedScheduling']);
    return {
      kind: 'pending',
      message: event?.message ? `Waiting for Pods to be scheduled — ${summarizeEventMessage(event.message)}.` : 'Waiting for Pods to be scheduled…',
      detail: event?.message,
      readyPodCount: 0, totalPodCount: pods.length,
    };
  }

  // Everything left is Running (or some other non-terminal phase) but none
  // of them have passed their readiness check yet.
  const readinessEvent = mostRecentEventFor(events, podNames, ['Unhealthy']);
  return {
    kind: 'not-ready',
    message: readinessEvent?.message ? `Waiting for the selected service to become Ready — ${summarizeEventMessage(readinessEvent.message)}.` : 'Waiting for the selected service to become Ready…',
    detail: readinessEvent?.message,
    readyPodCount: 0, totalPodCount: pods.length,
  };
}
