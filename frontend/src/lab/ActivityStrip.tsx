import type { LabExperiment, TimelineEvent } from '@kubeverse/shared';
import { Timeline } from '../Timeline';

// The Playground's bottom "Live Experiment / Kubernetes Timeline" strip
// (KUBEVERSE_MASTER_SPEC.md Phase 2, Parts 8-9). Recent Lab experiments are
// grouped into their own lifecycle sequence, each transition carrying the
// short explanation the backend attached (backend/src/lab/explanations.ts) -
// this is the "Learning Panel": explanations surface inline, at the exact
// transition they describe, rather than in a separate always-open panel.
// Every transition shown here was actually observed by the Kubernetes
// watch/SSE pipeline (backend/src/lab/experiments.ts) - nothing is
// synthesized to fill a gap; a step Kubernetes never reported for this
// experiment simply never appears.
export function ActivityStrip({ experiments, events }: { experiments: LabExperiment[]; events: TimelineEvent[] }) {
  return (
    <section className="activity-strip">
      <div className="activity-experiments">
        <h2>Live experiment timeline</h2>
        {experiments.length === 0
          ? <p className="muted">No experiments run yet - use Lab Controls to start one.</p>
          : experiments.slice(0, 3).map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} />)}
      </div>
      <Timeline events={events} />
    </section>
  );
}

function statusLabel(status: LabExperiment['status']): string {
  switch (status) {
    case 'preparing': return 'Preparing…';
    case 'running': return 'Running…';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Stopped';
  }
}

function ExperimentCard({ experiment }: { experiment: LabExperiment }) {
  return (
    <article className={`experiment-card status-${experiment.status}`}>
      <header>
        <strong>{experiment.action}</strong>
        <span className={`experiment-status status-${experiment.status}`}>{statusLabel(experiment.status)}</span>
      </header>
      {experiment.error && <p className="error">{experiment.error}</p>}
      {experiment.traffic && (
        <dl className="traffic-stats">
          <dt>Sent</dt><dd>{experiment.traffic.sent}</dd>
          <dt>Succeeded</dt><dd>{experiment.traffic.succeeded}</dd>
          <dt>Failed</dt><dd>{experiment.traffic.failed}</dd>
          <dt>RPS</dt><dd>{experiment.traffic.currentRps}</dd>
          <dt>Avg latency</dt><dd>{experiment.traffic.avgLatencyMs}ms</dd>
          <dt>Error rate</dt><dd>{Math.round(experiment.traffic.errorRate * 100)}%</dd>
        </dl>
      )}
      {experiment.transitions.length === 0 ? (
        <p className="muted">No Kubernetes transitions observed yet.</p>
      ) : (
        <ol className="experiment-transitions">
          {experiment.transitions.map((transition, index) => (
            <li key={index}>
              <time>{new Date(transition.timestamp).toLocaleTimeString()}</time>
              <span>{transition.note}</span>
              {transition.explanation && <p className="explanation">{transition.explanation}</p>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
