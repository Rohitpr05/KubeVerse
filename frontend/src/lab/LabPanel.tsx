import { useEffect, useRef, useState } from 'react';
import type { ClusterResource, LabExperiment } from '@kubeverse/shared';
import { api } from '../api';

const FAIL_POD_COUNTDOWN_SECONDS = 3;

// The Playground's interactive experiment controls (KUBEVERSE_MASTER_SPEC.md
// Phase 2, Part 1) - rendered inside LabDrawer.tsx's slide-over, never as a
// permanent layout column. Every control here only ever offers resources
// from `resources`, which the caller (PlaygroundView) already scopes to the
// current project via `/snapshot?projectId=` - there is no way to target a
// resource outside the open project from this UI, and the backend
// independently re-verifies ownership regardless (backend/src/routes/lab.ts).
export function LabPanel({ projectId, resources, activeExperiment, onExperimentStarted, onError }: {
  projectId: string;
  resources: ClusterResource[];
  activeExperiment?: LabExperiment;
  onExperimentStarted: (experiment: LabExperiment) => void;
  onError: (message: string) => void;
}) {
  const services = resources.filter((resource) => resource.kind === 'Service');
  const deployments = resources.filter((resource) => resource.kind === 'Deployment');
  const pods = resources.filter((resource) => resource.kind === 'Pod');

  const busy = activeExperiment?.status === 'preparing' || activeExperiment?.status === 'running';

  async function run<T>(action: () => Promise<T>): Promise<void> {
    try {
      await action();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      {busy && (
        <div className="lab-active-experiment">
          <p><strong>{activeExperiment!.action}</strong></p>
          <p className="muted">{activeExperiment!.status}…</p>
          <button onClick={() => run(async () => onExperimentStarted(await api.cancelExperiment(projectId, activeExperiment!.id)))}>Stop / Reset Experiment</button>
        </div>
      )}
      {!busy && (
        <>
          <TrafficControl projectId={projectId} services={services} onStart={onExperimentStarted} onError={onError} disabled={busy} />
          <FailPodControl projectId={projectId} pods={pods} onStart={onExperimentStarted} onError={onError} disabled={busy} />
          <RestartControl projectId={projectId} deployments={deployments} onStart={onExperimentStarted} onError={onError} disabled={busy} />
          <ScaleControl projectId={projectId} deployments={deployments} onStart={onExperimentStarted} onError={onError} disabled={busy} />
        </>
      )}
    </>
  );
}

function TrafficControl({ projectId, services, onStart, onError, disabled }: { projectId: string; services: ClusterResource[]; onStart: (experiment: LabExperiment) => void; onError: (message: string) => void; disabled: boolean }) {
  const [serviceKey, setServiceKey] = useState('');
  const [requests, setRequests] = useState(100);
  const [rps, setRps] = useState(20);
  const selected = services.find((service) => `${service.namespace}/${service.name}` === serviceKey);

  async function start() {
    if (!selected?.namespace) return onError('Select a service first.');
    try {
      onStart(await api.startTraffic(projectId, { serviceNamespace: selected.namespace, serviceName: selected.name, requests, requestsPerSecond: rps }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="lab-control">
      <h3>Traffic</h3>
      <label>Service<select value={serviceKey} onChange={(event) => setServiceKey(event.target.value)} disabled={disabled}>
        <option value="">Select a service…</option>
        {services.map((service) => <option key={service.uid} value={`${service.namespace}/${service.name}`}>{service.name}</option>)}
      </select></label>
      <label>Requests<input type="number" min={1} max={5000} value={requests} onChange={(event) => setRequests(Number(event.target.value))} disabled={disabled} /></label>
      <label>Requests/sec<input type="number" min={1} max={100} value={rps} onChange={(event) => setRps(Number(event.target.value))} disabled={disabled} /></label>
      <button onClick={start} disabled={disabled || !serviceKey}>Start Traffic</button>
      <p className="lab-hint">Sends real HTTP requests to this service's configured health check path, against its currently-Ready Pods, over a live port-forward.</p>
    </section>
  );
}

function FailPodControl({ projectId, pods, onStart, onError, disabled }: { projectId: string; pods: ClusterResource[]; onStart: (experiment: LabExperiment) => void; onError: (message: string) => void; disabled: boolean }) {
  const [podKey, setPodKey] = useState('');
  // The countdown target is captured once, at confirmation time, rather than
  // re-read from `selected` on every tick - `pods` is live SSE-driven data,
  // and re-deriving `selected` from a stale `podKey` right as the timer
  // fires could momentarily see it as gone if the Pod list happens to
  // reconcile mid-countdown.
  const [pendingTarget, setPendingTarget] = useState<{ name: string; namespace: string }>();
  const [countdown, setCountdown] = useState<number>();
  const selected = pods.find((pod) => `${pod.namespace}/${pod.name}` === podKey);

  function beginFail() {
    if (!selected?.namespace) return onError('Select a Pod first.');
    const confirmed = window.confirm(
      `This will terminate Pod "${selected.name}" and allow Kubernetes to demonstrate its self-healing behavior. Continue?`,
    );
    if (!confirmed) return;
    setPendingTarget({ name: selected.name, namespace: selected.namespace });
    setCountdown(FAIL_POD_COUNTDOWN_SECONDS);
  }

  function cancelCountdown() {
    setPendingTarget(undefined);
    setCountdown(undefined);
  }

  // onStart/onError are ultimately backed by PlaygroundView's
  // applyExperimentUpdate, a useCallback keyed on `rfNodes` - its identity
  // changes on essentially every SSE-driven topology update, which arrive far
  // more often than once a second. Depending on them directly would restart
  // this effect (clearing the pending setTimeout) before it ever reached
  // 1000ms, silently freezing the countdown - confirmed live: the number
  // never ticked past its starting value. Reading them through a ref keeps
  // the timer stable while still always calling the latest callback.
  const callbacksRef = useRef({ onStart, onError });
  useEffect(() => { callbacksRef.current = { onStart, onError }; });

  // Purely a frontend UX pause before the one real mutation - the countdown
  // itself has no Kubernetes meaning and updates no observed state; once it
  // reaches zero the real `api.failPod` call is what actually deletes the
  // Pod (KUBEVERSE_MASTER_SPEC.md Phase 2 UX refinement, Part 9).
  useEffect(() => {
    if (countdown === undefined || !pendingTarget) return;
    if (countdown <= 0) {
      const target = pendingTarget;
      setPendingTarget(undefined);
      setCountdown(undefined);
      void (async () => {
        try {
          const { experiment } = await api.failPod(projectId, target.name, target.namespace);
          callbacksRef.current.onStart(experiment);
        } catch (cause) {
          callbacksRef.current.onError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => (value ?? 1) - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, pendingTarget, projectId]);

  if (pendingTarget) {
    return (
      <section className="lab-control lab-countdown">
        <h3>Pod Failure</h3>
        <p>Failing <strong>{pendingTarget.name}</strong> in…</p>
        <div className="countdown-number">{countdown}</div>
        <button onClick={cancelCountdown}>Cancel</button>
      </section>
    );
  }

  return (
    <section className="lab-control">
      <h3>Pod Failure</h3>
      <label>Pod<select value={podKey} onChange={(event) => setPodKey(event.target.value)} disabled={disabled}>
        <option value="">Select a Pod…</option>
        {pods.map((pod) => <option key={pod.uid} value={`${pod.namespace}/${pod.name}`}>{pod.name}</option>)}
      </select></label>
      <button onClick={beginFail} disabled={disabled || !podKey}>Fail Pod</button>
    </section>
  );
}

function RestartControl({ projectId, deployments, onStart, onError, disabled }: { projectId: string; deployments: ClusterResource[]; onStart: (experiment: LabExperiment) => void; onError: (message: string) => void; disabled: boolean }) {
  const [deploymentKey, setDeploymentKey] = useState('');
  const selected = deployments.find((deployment) => `${deployment.namespace}/${deployment.name}` === deploymentKey);

  async function restart() {
    if (!selected?.namespace) return onError('Select a workload first.');
    try {
      const { experiment } = await api.restartWorkload(projectId, selected.name, selected.namespace);
      onStart(experiment);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="lab-control">
      <h3>Restart Workload</h3>
      <label>Deployment<select value={deploymentKey} onChange={(event) => setDeploymentKey(event.target.value)} disabled={disabled}>
        <option value="">Select a workload…</option>
        {deployments.map((deployment) => <option key={deployment.uid} value={`${deployment.namespace}/${deployment.name}`}>{deployment.name}</option>)}
      </select></label>
      <button onClick={restart} disabled={disabled || !deploymentKey}>Restart</button>
      <p className="lab-hint">A real rolling restart (same as `kubectl rollout restart`) - every Pod is recreated.</p>
    </section>
  );
}

function ScaleControl({ projectId, deployments, onStart, onError, disabled }: { projectId: string; deployments: ClusterResource[]; onStart: (experiment: LabExperiment) => void; onError: (message: string) => void; disabled: boolean }) {
  const [deploymentKey, setDeploymentKey] = useState('');
  const [replicas, setReplicas] = useState(1);
  const selected = deployments.find((deployment) => `${deployment.namespace}/${deployment.name}` === deploymentKey);

  async function apply() {
    if (!selected?.namespace) return onError('Select a workload first.');
    try {
      const { experiment } = await api.scaleWorkload(projectId, selected.name, selected.namespace, replicas);
      onStart(experiment);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="lab-control">
      <h3>Scale Workload</h3>
      <label>Deployment<select value={deploymentKey} onChange={(event) => { setDeploymentKey(event.target.value); const found = deployments.find((deployment) => `${deployment.namespace}/${deployment.name}` === event.target.value); if (found?.replicas) setReplicas(found.replicas.desired); }} disabled={disabled}>
        <option value="">Select a workload…</option>
        {deployments.map((deployment) => <option key={deployment.uid} value={`${deployment.namespace}/${deployment.name}`}>{deployment.name}</option>)}
      </select></label>
      <div className="scale-stepper">
        <button type="button" onClick={() => setReplicas((value) => Math.max(0, value - 1))} disabled={disabled}>−</button>
        <span>{replicas}</span>
        <button type="button" onClick={() => setReplicas((value) => Math.min(10, value + 1))} disabled={disabled}>+</button>
      </div>
      <button onClick={apply} disabled={disabled || !deploymentKey}>Apply</button>
      {selected?.replicas && <p className="lab-hint">Currently desired {selected.replicas.desired}, ready {selected.replicas.ready}.</p>}
    </section>
  );
}
