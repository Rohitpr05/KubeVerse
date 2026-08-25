import { useEffect, useState } from 'react';
import { api, type ArchitectureSpecView, type ProjectListEntry, type ProjectSummary } from '../api';
import type { ViewId } from '../shell/Sidebar';
import { ArchitecturePreview } from '../components/ArchitecturePreview';

export function ArchitecturesView({ currentProject, onOpenProject, navigate }: {
  currentProject: ProjectSummary | undefined;
  onOpenProject: (project: ProjectSummary) => void;
  navigate: (view: ViewId) => void;
}) {
  const [projects, setProjects] = useState<ProjectListEntry[]>();
  const [expanded, setExpanded] = useState<string>();
  const [specs, setSpecs] = useState<Record<string, ArchitectureSpecView>>({});
  const [switching, setSwitching] = useState<string>();

  useEffect(() => {
    void api.listProjects().then((result) => setProjects(result.projects)).catch(() => setProjects([]));
  }, []);

  async function toggleSpec(project: ProjectListEntry) {
    if (expanded === project.id) { setExpanded(undefined); return; }
    setExpanded(project.id);
    if (!specs[project.id]) {
      const detail = await api.getProject(project.id).catch(() => undefined);
      if (detail?.generatedState.spec) setSpecs((current) => ({ ...current, [project.id]: detail.generatedState.spec! }));
    }
  }

  async function openInBuilder(project: ProjectListEntry) {
    setSwitching(project.id);
    try {
      const opened = await api.openProject(project.path, project.name);
      onOpenProject(opened);
      navigate('ai-builder');
    } finally {
      setSwitching(undefined);
    }
  }

  const compiled = (projects ?? []).filter((project) => project.architecture.compiled);

  return (
    <div className="view">
      <h1>Architectures</h1>
      <p className="muted">Every architecture below was produced by compiling a project's <code>architecture.md</code> through the AI provider and validating the result - nothing here is invented by this page.</p>

      {projects === undefined && <p className="muted">Loading…</p>}

      {projects && compiled.length === 0 && (
        <section className="empty-hero">
          <h2>No architecture has been compiled yet</h2>
          <p className="muted">Describe an application in the AI Builder and compile it to see it here.</p>
          <div className="settings-actions"><button onClick={() => navigate('ai-builder')}>Open AI Builder</button></div>
        </section>
      )}

      {compiled.map((project) => (
        <section key={project.id} className="settings-card">
          <h2>{project.architecture.name ?? project.name}{project.id === currentProject?.id && <span className="muted"> (current project)</span>}</h2>
          <dl>
            <dt>Project</dt><dd>{project.name}</dd>
            <dt>Services</dt><dd>{project.architecture.serviceCount ?? 0}</dd>
            <dt>Status</dt><dd>{project.architecture.lastGeneratedAt ? 'Docker + Kubernetes generated' : 'Compiled, not generated yet'}</dd>
            <dt>Last generated</dt><dd>{project.architecture.lastGeneratedAt ? new Date(project.architecture.lastGeneratedAt).toLocaleString() : 'Never'}</dd>
          </dl>
          <div className="settings-actions">
            <button onClick={() => void openInBuilder(project)} disabled={switching === project.id}>{switching === project.id ? 'Opening…' : 'Open'}</button>
            <button onClick={() => void toggleSpec(project)}>{expanded === project.id ? 'Hide Spec' : 'View Spec'}</button>
          </div>
          {expanded === project.id && (specs[project.id] ? <ArchitecturePreview spec={specs[project.id]} /> : <p className="muted">Loading…</p>)}
        </section>
      ))}
    </div>
  );
}
