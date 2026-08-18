import { useEffect, useState } from 'react';
import type { ClusterResource, ResourceDetail } from '@simulator/shared/platform-contract';

function resourcePath(resource: ClusterResource): string { return `/resource/${resource.kind}/${resource.namespace ?? 'cluster'}/${encodeURIComponent(resource.name)}`; }
function age(timestamp?: string): string { if (!timestamp) return 'unknown'; const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`; }

export function Inspector({ resource }: { resource?: ClusterResource }) {
  const [detail, setDetail] = useState<ResourceDetail>();
  const [logs, setLogs] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setDetail(undefined); setLogs(undefined); setError(undefined);
    if (!resource || resource.kind === 'Container') return;
    void fetch(resourcePath(resource)).then(async (response) => { if (!response.ok) throw new Error(`Detail request failed: ${response.status}`); return response.json() as Promise<ResourceDetail>; }).then(setDetail).catch((cause) => setError(cause.message));
  }, [resource]);
  useEffect(() => {
    if (!resource || resource.kind !== 'Pod' || !resource.namespace) return;
    const load = () => fetch(`/logs?namespace=${encodeURIComponent(resource.namespace!)}&name=${encodeURIComponent(resource.name)}&tailLines=200`).then((response) => response.ok ? response.json() : Promise.reject(new Error('Log request failed'))).then((payload) => setLogs(payload.logs)).catch((cause) => setError(cause.message));
    void load(); const interval = window.setInterval(load, 3000); return () => window.clearInterval(interval);
  }, [resource]);
  if (!resource) return <section className="inspector empty"><h2>Select a Kubernetes resource</h2><p>Click any node in the topology to inspect it.</p></section>;
  const labels = Object.entries(resource.labels);
  const annotations = Object.entries(resource.annotations);
  return <section className="inspector">
    <h2>{resource.name}</h2><p className="kind-badge">{resource.kind}</p>
    <dl><dt>Namespace</dt><dd>{resource.namespace ?? 'cluster-scoped'}</dd><dt>Status</dt><dd>{resource.status}</dd><dt>Owner</dt><dd>{resource.owner ? `${resource.owner.kind}/${resource.owner.name}` : 'none'}</dd><dt>Age</dt><dd>{age(resource.creationTimestamp)}</dd></dl>
    <h3>Labels</h3>{labels.length ? <KeyValues items={labels} /> : <p className="muted">No labels</p>}
    <h3>Annotations</h3>{annotations.length ? <KeyValues items={annotations} /> : <p className="muted">No annotations</p>}
    <h3>Conditions</h3>{resource.conditions.length ? <ul>{resource.conditions.map((condition) => <li key={condition.type}><strong>{condition.type}</strong>: {condition.status} {condition.reason ? `(${condition.reason})` : ''}</li>)}</ul> : <p className="muted">No conditions</p>}
    {detail?.events.length ? <><h3>Related events</h3><ul>{detail.events.slice(0, 10).map((event) => <li key={event.uid}>{event.reason}: {event.message}</li>)}</ul></> : null}
    {resource.kind === 'Pod' && <><h3>Live logs</h3><pre className="logs">{logs ?? 'Loading logs…'}</pre></>}
    {detail && <details className="yaml-details"><summary>Raw YAML</summary><pre className="yaml">{detail.rawYaml}</pre></details>}
    {error && <p className="error">{error}</p>}
  </section>;
}
function KeyValues({ items }: { items: Array<[string, string]> }) { return <ul>{items.map(([key, value]) => <li key={key}><code>{key}</code>: {value}</li>)}</ul>; }
