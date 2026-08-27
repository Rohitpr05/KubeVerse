import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

// Lab Controls as a slide-over drawer, not a permanent third column
// (KUBEVERSE_MASTER_SPEC.md Phase 2 UX refinement, Part 1). Portaled to
// document.body for the same reason NewProjectModal/PopoverDropdown are -
// see styles.css's stacking-context notes - which also happens to be exactly
// what "overlay the Workspace sidebar" requires: a portal is the only way to
// paint above `.sidebar`, a *sibling* of `.shell-content` (and everything
// inside it, including this component's real DOM parent), without a fixed
// z-index arms race. `position: fixed` makes it viewport-relative, so it
// overlays the Workspace sidebar and the topology alike without depending on
// either one's layout, and never reserves any layout width itself - closing
// it gives that space back to the topology for free, because the drawer was
// never part of any flex/grid track to begin with.
//
// The component always renders (rather than being conditionally mounted) so
// its own children (LabPanel, and whatever in-progress form state it holds)
// never get destroyed by opening/closing - only its `translateX` and
// `aria-hidden` change.
export function LabDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  // Matches PopoverDropdown's existing Escape-to-close pattern - only
  // listens while actually open, so it never interferes with Escape doing
  // something else (e.g. deselecting a Playground node) while closed.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  return createPortal(
    <aside className={`lab-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Lab Controls">
      <div className="lab-drawer-header">
        <h2>Lab Controls</h2>
        <button className="lab-drawer-close" onClick={onClose} title="Close" aria-label="Close Lab Controls">×</button>
      </div>
      <div className="lab-drawer-body scroll-clean">{children}</div>
    </aside>,
    document.body,
  );
}
