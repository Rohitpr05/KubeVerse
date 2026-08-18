import type { TimelineEvent } from '@simulator/shared/platform-contract';

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return <section className="timeline"><h2>Live timeline</h2>{events.length === 0 ? <p className="muted">No observed events yet.</p> : <ol>{events.slice(0, 30).map((event) => <li key={event.uid}><time>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'}</time><span className={`event-source ${event.source}`}>{event.source === 'kubernetes_event' ? event.reason ?? 'Event' : event.action}</span><span>{event.message ?? `${event.involvedKind ?? 'Resource'} ${event.involvedName ?? ''}`}</span></li>)}</ol>}</section>;
}
