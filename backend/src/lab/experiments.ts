// The Lab experiment tracker: bookkeeping around real Kubernetes state
// transitions a mutation triggers, never a second simulated state model.
// Kubernetes (via ClusterState, the existing observer/SSE pipeline) remains
// the only source of truth - this class only *listens* to the exact same
// update stream server.ts's SSE broadcast already receives (ClusterState.subscribe,
// added for this purpose) and decides which of those real updates belong to
// which in-flight experiment.
//
// Convergence rule (shared across pod-failure/restart/scale): every one of
// those actions targets - directly or via its owner chain - a Deployment.
// An experiment is seeded with its target's own uid plus every uid up its
// owner chain (Pod -> ReplicaSet -> Deployment), resolved once at start from
// currently-observed state. A tracked resource's own children (e.g. a
// replacement Pod the ReplicaSet creates) get added to the tracked set
// dynamically the moment they're observed, purely by matching
// `resource.owner.uid` against the set - so the SAME generic rule covers "a
// replacement Pod appears after a failure", "a rolling restart creates a new
// ReplicaSet and new Pods", and "scaling creates N new Pods" without any
// per-kind special-casing. The experiment completes the moment the tracked
// Deployment itself reports ready === current === desired again - the same
// real field `kubectl get deploy` shows.
import { randomUUID } from 'node:crypto';
import type { ClusterKind, ClusterResource, ClusterUpdate, LabExperiment, LabExperimentKind, LabTransition, TimelineEvent } from '@kubeverse/shared';
import type { ClusterState } from '../cluster-state.js';
import { explainReason, explainStatus, replicaSetExplanation } from './explanations.js';

const MAX_EXPERIMENTS_PER_PROJECT = 20;
const MAX_TRANSITIONS = 100;
// Generous but bounded: a slow image pull or an overloaded local cluster can
// legitimately take a while, but an experiment must not track forever - past
// this, the experiment is marked 'failed' with an honest "not observed"
// explanation rather than silently hanging (Part 13 - failures must be
// visible, not hidden).
const CONVERGENCE_TIMEOUT_MS = 120_000;

type Listener = (experiment: LabExperiment) => void;
type TerminalStatus = 'completed' | 'failed' | 'cancelled';

interface TrackedRuntime {
  experiment: LabExperiment;
  trackedUids: Set<string>;
  timeoutHandle?: NodeJS.Timeout;
}

function clone(experiment: LabExperiment): LabExperiment {
  return { ...experiment, target: { ...experiment.target }, transitions: [...experiment.transitions], traffic: experiment.traffic ? { ...experiment.traffic } : undefined };
}

export class ExperimentTracker {
  private readonly byProject = new Map<string, LabExperiment[]>();
  private readonly runtime = new Map<string, TrackedRuntime>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly state: ClusterState) {
    state.subscribe((update, resource, event) => this.onClusterUpdate(update, resource, event));
  }

  list(projectId: string): LabExperiment[] { return (this.byProject.get(projectId) ?? []).map(clone); }
  get(projectId: string, id: string): LabExperiment | undefined {
    const found = (this.byProject.get(projectId) ?? []).find((experiment) => experiment.id === id);
    return found ? clone(found) : undefined;
  }

  subscribe(projectId: string, listener: Listener): () => void {
    if (!this.listeners.has(projectId)) this.listeners.set(projectId, new Set());
    this.listeners.get(projectId)!.add(listener);
    return () => this.listeners.get(projectId)?.delete(listener);
  }

  start(projectId: string, kind: LabExperimentKind, target: ClusterResource, action: string): LabExperiment {
    const experiment: LabExperiment = {
      id: randomUUID(), projectId, kind,
      target: { kind: target.kind, namespace: target.namespace ?? '', name: target.name },
      action, startedAt: new Date().toISOString(), status: 'preparing', transitions: [],
    };
    const list = this.byProject.get(projectId) ?? [];
    list.unshift(experiment);
    this.byProject.set(projectId, list.slice(0, MAX_EXPERIMENTS_PER_PROJECT));

    const runtime: TrackedRuntime = { experiment, trackedUids: this.ownerChain(target) };
    // unref(): a pending experiment-timeout must never be the thing keeping
    // the backend process (or a test run) alive - it's purely a bound on how
    // long this class keeps tracking, not application-critical work.
    if (kind !== 'traffic') runtime.timeoutHandle = setTimeout(() => this.timeout(experiment.id), CONVERGENCE_TIMEOUT_MS).unref();
    this.runtime.set(experiment.id, runtime);
    this.notify(experiment);
    return clone(experiment);
  }

  setRunning(id: string): void {
    const runtime = this.runtime.get(id);
    if (!runtime || runtime.experiment.status !== 'preparing') return;
    runtime.experiment.status = 'running';
    this.notify(runtime.experiment);
  }

  fail(id: string, error: string): void {
    const runtime = this.runtime.get(id);
    if (runtime) runtime.experiment.error = error;
    this.finish(id, 'failed');
  }

  cancel(id: string): void { this.finish(id, 'cancelled'); }

  // Traffic experiments don't observe Kubernetes resource transitions at all
  // - the traffic runner drives status/stats directly from real measured
  // HTTP request outcomes.
  updateTraffic(id: string, traffic: LabExperiment['traffic']): void {
    const runtime = this.runtime.get(id);
    if (!runtime) return;
    runtime.experiment.traffic = traffic;
    this.notify(runtime.experiment);
  }

  completeTraffic(id: string): void { this.finish(id, 'completed'); }

  private ownerChain(resource: ClusterResource): Set<string> {
    const uids = new Set<string>([resource.uid]);
    let current: ClusterResource | undefined = resource;
    while (current?.owner) {
      const parent = this.state.resourceByUid(current.owner.uid);
      if (!parent || uids.has(parent.uid)) break;
      uids.add(parent.uid);
      current = parent;
    }
    return uids;
  }

  private onClusterUpdate(update: ClusterUpdate, resource?: ClusterResource, event?: TimelineEvent): void {
    for (const runtime of this.runtime.values()) {
      if (runtime.experiment.kind === 'traffic') continue;
      if (update.kind === 'Event') this.observeEvent(runtime, event);
      else this.observeResource(runtime, update, resource);
    }
  }

  private observeEvent(runtime: TrackedRuntime, event?: TimelineEvent): void {
    if (!event?.involvedUid || !runtime.trackedUids.has(event.involvedUid) || !event.reason) return;
    this.appendTransition(runtime, {
      timestamp: event.timestamp ?? new Date().toISOString(),
      kind: (event.involvedKind as ClusterKind) ?? 'Pod',
      name: event.involvedName ?? '?',
      status: event.reason,
      note: event.message ?? event.reason,
      explanation: explainReason(event.reason),
    });
  }

  private observeResource(runtime: TrackedRuntime, update: ClusterUpdate, resource?: ClusterResource): void {
    if (!resource) return;
    const isTracked = runtime.trackedUids.has(resource.uid);
    const isChildOfTracked = Boolean(resource.owner && runtime.trackedUids.has(resource.owner.uid));
    if (!isTracked && !isChildOfTracked) return;
    if (isChildOfTracked) runtime.trackedUids.add(resource.uid);

    const deleted = update.action === 'DELETED';
    const status = deleted ? 'Terminated' : resource.status;
    const note = deleted ? `${resource.kind} ${resource.name} terminated` : `${resource.kind} ${resource.name}: ${resource.status}`;
    const explanation = !deleted && resource.replicas
      ? replicaSetExplanation(resource.replicas.desired, resource.replicas.current, resource.replicas.ready)
      : (!deleted ? explainStatus(resource.kind, resource.status) : undefined);
    this.appendTransition(runtime, { timestamp: update.timestamp, kind: resource.kind, name: resource.name, status, note, explanation });

    if (runtime.experiment.status === 'preparing') runtime.experiment.status = 'running';

    if (!deleted && resource.kind === 'Deployment' && resource.replicas) {
      const { desired, current, ready } = resource.replicas;
      if (desired > 0 && desired === current && desired === ready) this.finish(runtime.experiment.id, 'completed');
    }
  }

  private appendTransition(runtime: TrackedRuntime, transition: LabTransition): void {
    const last = runtime.experiment.transitions.at(-1);
    if (last && last.kind === transition.kind && last.name === transition.name && last.status === transition.status) return;
    runtime.experiment.transitions.push(transition);
    if (runtime.experiment.transitions.length > MAX_TRANSITIONS) runtime.experiment.transitions.shift();
    this.notify(runtime.experiment);
  }

  private timeout(id: string): void {
    const runtime = this.runtime.get(id);
    if (!runtime) return;
    runtime.experiment.error = 'Convergence was not observed within the tracking window. The underlying Kubernetes action was still requested and may still be in progress - check the Playground topology directly.';
    this.finish(id, 'failed');
  }

  private finish(id: string, status: TerminalStatus): void {
    const runtime = this.runtime.get(id);
    if (!runtime || ['completed', 'failed', 'cancelled'].includes(runtime.experiment.status)) return;
    if (runtime.timeoutHandle) clearTimeout(runtime.timeoutHandle);
    runtime.experiment.status = status;
    runtime.experiment.endedAt = new Date().toISOString();
    this.runtime.delete(id);
    this.notify(runtime.experiment);
  }

  private notify(experiment: LabExperiment): void {
    const snapshot = clone(experiment);
    for (const listener of this.listeners.get(experiment.projectId) ?? []) listener(snapshot);
  }
}
