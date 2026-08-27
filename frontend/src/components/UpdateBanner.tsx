import { useEffect, useState } from 'react';
import { downloadUpdate, getUpdateState, onUpdateState, quitAndInstall } from '../desktop';
import { bannerMessage, bannerTitle, primaryAction, shouldShowBanner, type UpdateState } from '../updateLogic';

// Desktop-only, non-intrusive update banner (Phase 3B, §12) - mounted once
// in App.tsx alongside the rest of the shell, never a full-page takeover.
// Silent for "checking"/"not-available"/"error"/"idle" (see
// updateLogic.ts's shouldShowBanner) - the once-per-launch background check
// in desktop/src/updater.js never interrupts the user unless there's
// actually something to act on. "Later" only dismisses this render pass;
// nothing is persisted, so a real update still shows again next launch
// until the user acts on it.
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getUpdateState().then(setState);
    return onUpdateState((next) => { setState(next); setDismissed(false); });
  }, []);

  if (!shouldShowBanner(state) || dismissed) return null;
  const action = primaryAction(state);

  async function runPrimaryAction() {
    if (action === 'download') {
      setBusy(true);
      try { await downloadUpdate(); } finally { setBusy(false); }
    } else if (action === 'restart') {
      // The only place a real restart-to-install is ever triggered - always
      // this exact explicit click, never automatic (§12).
      await quitAndInstall();
    }
  }

  return (
    <div className="update-banner">
      <div className="update-banner-text">
        <strong>{bannerTitle(state)}</strong>
        <span className="muted">{bannerMessage(state)}</span>
      </div>
      <div className="update-banner-actions">
        {action && (
          <button onClick={() => void runPrimaryAction()} disabled={busy}>
            {action === 'download' ? (busy ? 'Starting…' : 'Download Update') : 'Restart and Update'}
          </button>
        )}
        <button className="link-button" onClick={() => setDismissed(true)}>Later</button>
      </div>
    </div>
  );
}
