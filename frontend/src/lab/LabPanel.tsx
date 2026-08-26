import { useState } from 'react';
import type { ClusterResource, LabExperiment } from '@kubeverse/shared';
import { api } from '../api';

// The Playground's interactive experiment controls (KUBEVERSE_MASTER_SPEC.md
// Phase 2, Part 1). Deliberately its own collapsible side panel, not folded
// into the topology toolbar - these are project-mutating actions, distinct
// from the read-only Fit/Reset/Lock/filter controls above the canvas.
// Every control here only ever offers resources from `resources`, which the
// caller (PlaygroundView) already scopes to the current project via
// `/snapshot?projectId=` - there is no way to target a resource outside the
// open project from this UI, and the backend independently re-verifies
// ownership regardless (backend/src/routes/lab.ts).
export function LabPanel({ projectId, resources, activeExperiment, onExperimentStarted, onError }: {
  projectId: string;
  resources: ClusterResource[];
  activeExperiment?: LabExperiment;
  onExperimentStarted: (experiment: LabExperiment) => void;
  onError: (message: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
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

  if (collapsed) {
    return (
      <aside className="lab-panel collapsed">
        <button className="lab-panel-toggle" onClick={() => setCollapsed(false)} title="Expand Lab Controls">🧪</button>
      </aside>
    );
  }

  return (
    <aside className="lab-panel">
      <div className="lab-panel-header">
        <h2>Lab Controls</h2>
        <button className="lab-panel-toggle" onClick={() => setCollapsed(true)} title="Collapse">«</button>
      </div>
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
    </aside>
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
  const selected = pods.find((pod) => `${pod.namespace}/${pod.name}` === podKey);

  async function fail() {
    if (!selected?.namespace) return onError('Select a Pod first.');
    const confirmed = window.confirm(
      `This will terminate Pod "${selected.name}" and allow Kubernetes to demonstrate its self-healing behavior. Continue?`,
    );
    if (!confirmed) return;
    try {
      const { experiment } = await api.failPod(projectId, selected.name, selected.namespace);
      onStart(experiment);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="lab-control">
      <h3>Pod Failure</h3>
      <label>Pod<select value={podKey} onChange={(event) => setPodKey(event.target.value)} disabled={disabled}>
        <option value="">Select a Pod…</option>
        {pods.map((pod) => <option key={pod.uid} value={`${pod.namespace}/${pod.name}`}>{pod.name}</option>)}
      </select></label>
      <button onClick={fail} disabled={disabled || !podKey}>Fail Pod</button>
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
