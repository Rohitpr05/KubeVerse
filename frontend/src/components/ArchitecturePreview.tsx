import type { ArchitectureSpecView } from '../api';

// Orders services for the flow diagram using Kahn's algorithm over the
// declared traffic edges. This is a *readability* arrangement only - the
// authoritative relationships are the traffic edges rendered below it,
// straight from the validated spec, never invented by the frontend.
function topologicalOrder(spec: ArchitectureSpecView): string[] {
  const names = spec.services.map((service) => service.name);
  const inDegree = new Map(names.map((name) => [name, 0]));
  for (const edge of spec.traffic) {
    if (inDegree.has(edge.to)) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const queue = names.filter((name) => inDegree.get(name) === 0);
  const order: string[] = [];
  const remaining = new Map(inDegree);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (order.includes(current)) continue;
    order.push(current);
    for (const edge of spec.traffic.filter((candidate) => candidate.from === current)) {
      const next = remaining.get(edge.to);
      if (next === undefined) continue;
      remaining.set(edge.to, next - 1);
      if (next - 1 === 0) queue.push(edge.to);
    }
  }
  for (const name of names) if (!order.includes(name)) order.push(name);
  return order;
}

function hasEdge(spec: ArchitectureSpecView, from: string, to: string): boolean {
  return spec.traffic.some((edge) => edge.from === from && edge.to === to);
}

export function ArchitecturePreview({ spec }: { spec: ArchitectureSpecView }) {
  const order = topologicalOrder(spec);
  const byName = new Map(spec.services.map((service) => [service.name, service]));

  return (
    <div className="architecture-preview">
      <div className="architecture-flow">
        {order.map((name, index) => {
          const service = byName.get(name);
          if (!service) return null;
          const next = order[index + 1];
          const connected = next !== undefined && hasEdge(spec, name, next);
          return (
            <div key={name} className="flow-step">
              <div className="flow-box">
                <span className="flow-box-name">{service.name}</span>
                <span className="flow-box-meta">{service.runtime} · :{service.port}</span>
              </div>
              {index < order.length - 1 && <div className={connected ? 'flow-arrow' : 'flow-arrow disconnected'}>↓</div>}
            </div>
          );
        })}
      </div>

      {spec.traffic.length > 0 && (
        <ul className="traffic-edges">
          {spec.traffic.map((edge, index) => (
            <li key={index}>
              <code>{edge.from}</code> → <code>{edge.to}</code>
              {edge.description && <span className="muted"> — {edge.description}</span>}
            </li>
          ))}
        </ul>
      )}

      <table className="service-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Type</th>
            <th>Runtime</th>
            <th>Port</th>
            <th>Replicas</th>
            <th>Depends on</th>
            <th>Persistence</th>
            <th>Exposed</th>
          </tr>
        </thead>
        <tbody>
          {spec.services.map((service) => (
            <tr key={service.name}>
              <td>{service.name}</td>
              <td>{service.type}</td>
              <td>{service.runtime}</td>
              <td>{service.port} ({service.protocol})</td>
              <td>{service.replicas}</td>
              <td>{service.dependsOn.length > 0 ? service.dependsOn.join(', ') : '—'}</td>
              <td>{service.volume ? `${service.volume.sizeGi} GiB at ${service.volume.mountPath}` : '—'}</td>
              <td>{service.expose ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
