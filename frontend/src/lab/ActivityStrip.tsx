import { useState } from 'react';
import type { LabExperiment, TimelineEvent } from '@kubeverse/shared';
import { Timeline } from '../Timeline';

// The Playground's bottom "Live Experiment / Kubernetes Timeline" strip
// (KUBEVERSE_MASTER_SPEC.md Phase 2, Parts 8-9, 12). Recent Lab experiments
// are grouped into their own lifecycle checklist, each transition carrying
// the short explanation the backend attached (backend/src/lab/explanations.ts) -
// this is the "Learning Panel": explanations surface inline, at the exact
// transition they describe, rather than in a separate always-open panel.
// Every transition shown here was actually observed by the Kubernetes
// watch/SSE pipeline (backend/src/lab/experiments.ts) - nothing is
// synthesized to fill a gap; a step Kubernetes never reported for this
// experiment simply never appears.
//
// Both halves collapse independently (UX refinement, Part 2) to a slim
// header so the topology above can reclaim the vertical space - collapsing
// only hides the body via CSS (`.activity-panel-body`'s `display`), it never
// unmounts Timeline or drops any experiment/event data, so a running
// experiment keeps updating normally while its panel is hidden.
export function ActivityStrip({ experiments, events }: { experiments: LabExperiment[]; events: TimelineEvent[] }) {
  const [experimentsOpen, setExperimentsOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const allCollapsed = !experimentsOpen && !timelineOpen;

  return (
    <section className={`activity-strip ${allCollapsed ? 'all-collapsed' : ''}`}>
      <div className={`activity-panel activity-experiments ${experimentsOpen ? '' : 'collapsed'}`}>
        <button className="activity-panel-header" onClick={() => setExperimentsOpen((value) => !value)}>
          <span>Live experiment timeline</span>
          <span className="activity-panel-chevron">{experimentsOpen ? '⌄' : '›'}</span>
        </button>
        <div className="activity-panel-body scroll-clean">
          {experiments.length === 0
            ? <p className="muted">No experiments run yet - use Lab Controls to start one.</p>
            : experiments.slice(0, 3).map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} />)}
        </div>
      </div>
      <div className={`activity-panel activity-kube-timeline ${timelineOpen ? '' : 'collapsed'}`}>
        <button className="activity-panel-header" onClick={() => setTimelineOpen((value) => !value)}>
          <span>Kubernetes live timeline</span>
          <span className="activity-panel-chevron">{timelineOpen ? '⌄' : '›'}</span>
        </button>
        <div className="activity-panel-body scroll-clean">
          <Timeline events={events} />
        </div>
      </div>
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

// A transition already observed is drawn as a completed checklist step (✓) -
// there is no meaningful "pending/not yet reached" step to show ahead of it,
// since a step Kubernetes hasn't reported yet simply doesn't exist as data.
// The one truly forward-looking marker is the experiment's own current
// status line at the end (● running / ✓ completed / ✗ failed / ○ stopped),
// matching the checklist shape from the Phase 2 UX spec without inventing
// steps that were never actually observed.
function statusIcon(status: LabExperiment['status']): string {
  switch (status) {
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '○';
    default: return '●';
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
              <span className="transition-check">✓</span>
              <time>{new Date(transition.timestamp).toLocaleTimeString()}</time>
              <span>{transition.note}</span>
              {transition.explanation && <p className="explanation">{transition.explanation}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className={`experiment-final-line status-${experiment.status}`}>
        <span className="transition-check">{statusIcon(experiment.status)}</span>
        {experiment.status === 'running' || experiment.status === 'preparing' ? 'Experiment in progress' : `Experiment ${statusLabel(experiment.status).toLowerCase().replace('…', '')}`}
      </p>
    </article>
  );
}
