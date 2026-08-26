export type StageStatus = 'pending' | 'active' | 'done' | 'error';

export interface Stage {
  key: string;
  label: string;
  status: StageStatus;
  error?: string;
}

const ICONS: Record<StageStatus, string> = { pending: '○', active: '●', done: '✓', error: '✗' };

// Every stage transition here is driven by a real request being sent, a real
// response arriving, or a real success/failure - never a setTimeout running
// from 0 to 100. The fill width is just "how many real stages have finished
// so far", so it only ever moves when something real actually happened.
export function GenerationProgress({ title, stages }: { title: string; stages: Stage[] }) {
  const doneCount = stages.filter((stage) => stage.status === 'done').length;
  const failed = stages.find((stage) => stage.status === 'error');
  const percent = Math.round((doneCount / stages.length) * 100);
  const complete = doneCount === stages.length;

  return (
    <div className="generation-progress">
      <p className="generation-progress-title">{title}</p>
      <div className="progress-bar"><div className={failed ? 'progress-bar-fill error' : 'progress-bar-fill'} style={{ width: `${percent}%` }} /></div>
      <ul className="stage-list">
        {stages.map((stage) => (
          <li key={stage.key} className={`stage-item ${stage.status}`}>
            <span className="stage-icon" aria-hidden="true">{ICONS[stage.status]}</span>
            <span className="stage-label">{stage.label}</span>
            {stage.status === 'error' && stage.error && <span className="stage-error">{stage.error}</span>}
          </li>
        ))}
      </ul>
      {!failed && !complete && <p className="muted">This may take a moment…</p>}
    </div>
  );
}
