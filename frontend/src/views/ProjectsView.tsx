import { useEffect, useState } from 'react';
import { api, type ProjectDetail, type ProjectListEntry, type ProjectSummary } from '../api';
import type { ViewId } from '../shell/Sidebar';

export function ProjectsView({ currentProject, onOpenProject, navigate, restored }: {
  currentProject: ProjectSummary | undefined;
  onOpenProject: (project: ProjectSummary) => void;
  navigate: (view: ViewId) => void;
  restored: boolean;
}) {
  const [recent, setRecent] = useState<ProjectListEntry[]>();
  const [detail, setDetail] = useState<ProjectDetail>();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const refresh = () => { void api.listProjects().then((result) => setRecent(result.projects)).catch(() => setRecent([])); };
  useEffect(refresh, []);

  useEffect(() => {
    if (!currentProject) { setDetail(undefined); return; }
    void api.getProject(currentProject.id).then(setDetail).catch(() => setDetail(undefined));
  }, [currentProject?.id]);

  async function openProject(targetPath: string, targetName?: string) {
    setError(undefined);
    setOpening(true);
    try {
      const project = await api.openProject(targetPath, targetName);
      onOpenProject(project);
      setPath('');
      setName('');
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to open project.');
    } finally {
      setOpening(false);
    }
  }

  const openForm = (
    <section className="settings-card">
      <h2>Create or open a project</h2>
      <p className="muted">A project is just a directory on your machine. KubeVerse reads and writes files there directly - nothing is uploaded anywhere.</p>
      <label>Directory path<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Users/you/my-kubeverse-project" /></label>
      <label>Name (used only when creating a new project)<input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-kubeverse-project" /></label>
      <div className="settings-actions">
        <button disabled={!path.trim() || opening} onClick={() => void openProject(path.trim(), name.trim() || undefined)}>{opening ? 'Opening…' : 'Create / Open Project'}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );

  if (!restored) {
    return <div className="view projects-view"><h1>Projects</h1><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="view projects-view">
      <h1>Projects</h1>

      {!currentProject && (
        <section className="empty-hero">
          <h2>No project yet</h2>
          <p className="muted">Create a new local project or open one you've used with KubeVerse before to get started.</p>
        </section>
      )}

      {currentProject && (
        <section className="settings-card project-detail-card">
          <h2>Current project</h2>
          <dl>
            <dt>Project</dt><dd>{currentProject.name}</dd>
            <dt>Location</dt><dd className="mono">{currentProject.path}</dd>
            <dt>Status</dt><dd>Local</dd>
            <dt>Architecture</dt>
            <dd>{detail?.generatedState.spec ? `Compiled (${detail.generatedState.spec.services.length} services)` : 'Not compiled'}</dd>
            <dt>Generated artifacts</dt>
            <dd>{detail?.generatedState.files?.length ?? 0} files{detail?.generatedState.lastGeneratedAt ? ` · last generated ${new Date(detail.generatedState.lastGeneratedAt).toLocaleString()}` : ''}</dd>
          </dl>
          <div className="settings-actions">
            <button onClick={() => navigate('ai-builder')}>Open in AI Builder</button>
            <button onClick={() => navigate('playground')}>Open Playground</button>
            <button onClick={() => navigate('architectures')} disabled={!detail?.generatedState.spec}>View Architecture</button>
          </div>
        </section>
      )}

      {openForm}

      <section className="settings-card">
        <h2>Recent projects</h2>
        {recent === undefined && <p className="muted">Loading…</p>}
        {recent?.length === 0 && <p className="muted">No projects opened yet.</p>}
        {recent && recent.length > 0 && (
          <ul className="project-list">
            {recent.map((project) => (
              <li key={project.id} className={project.id === currentProject?.id ? 'active' : ''}>
                <div>
                  <strong>{project.name}</strong>
                  <div className="muted mono">{project.path}</div>
                  <div className="muted">{project.architecture.compiled ? `Architecture: ${project.architecture.name ?? 'compiled'} (${project.architecture.serviceCount ?? 0} services)` : 'No architecture compiled yet'}</div>
                </div>
                <button onClick={() => void openProject(project.path, project.name)}>{project.id === currentProject?.id ? 'Current' : 'Switch to this'}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
