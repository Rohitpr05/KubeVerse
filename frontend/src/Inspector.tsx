import type { ClusterResource } from '@simulator/shared/platform-contract';

export function Inspector({ resource }: { resource?: ClusterResource }) {
  if (!resource) return <aside className="inspector empty">Select any object in the topology to inspect its observed Kubernetes state.</aside>;
  const labels = Object.entries(resource.labels);
  return (
    <aside className="inspector">
      <h2>{resource.name}</h2>
      <dl>
        <dt>Kind</dt><dd>{resource.kind}</dd>
        <dt>Namespace</dt><dd>{resource.namespace ?? 'cluster-scoped'}</dd>
        <dt>Status</dt><dd>{resource.status}</dd>
        <dt>Created</dt><dd>{resource.creationTimestamp ? new Date(resource.creationTimestamp).toLocaleString() : 'unknown'}</dd>
        <dt>Owner</dt><dd>{resource.owner ? `${resource.owner.kind}/${resource.owner.name}` : 'none'}</dd>
      </dl>
      <h3>Labels</h3>
      {labels.length === 0 ? <p className="muted">No labels</p> : <ul>{labels.map(([key, value]) => <li key={key}><code>{key}</code>: {value}</li>)}</ul>}
    </aside>
  );
}
