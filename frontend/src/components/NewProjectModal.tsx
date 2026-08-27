import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type ProjectSummary } from '../api';

// Portaled to document.body for the same reason PopoverDropdown.tsx is: a
// modal opened from deep inside .shell-content (overflow-y: auto) shouldn't
// depend on none of its ancestors ever clipping or out-stacking it.
export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: ProjectSummary) => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  // The input's own onKeyDown already handles Escape while it's focused
  // (below) - this document-level listener covers Escape after the user has
  // Tab'd away from the input (e.g. onto Cancel/Create), which previously
  // did nothing at all.
  useEffect(() => {
    if (creating) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [creating, onClose]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const project = await api.createProject(trimmed);
      onCreated(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="New KubeVerse Project">
        <h2>New KubeVerse Project</h2>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My E-Commerce App"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
              if (event.key === 'Escape') onClose();
            }}
          />
        </label>
        <p className="muted">KubeVerse creates a local project folder for this automatically - you don't need to choose a location.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="settings-actions modal-actions">
          <button onClick={onClose} disabled={creating}>Cancel</button>
          <button onClick={() => void create()} disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
