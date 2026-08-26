import { useEffect, useState } from 'react';
import { api, type ProjectDetail, type ProjectListEntry, type ProjectSummary } from '../api';
import type { ViewId } from '../shell/Sidebar';
import { NewProjectModal } from '../components/NewProjectModal';

export function ProjectsView({ currentProject, onOpenProject, navigate, restored }: {
  currentProject: ProjectSummary | undefined;
  onOpenProject: (project: ProjectSummary) => void;
  navigate: (view: ViewId) => void;
  restored: boolean;
}) {
  const [recent, setRecent] = useState<ProjectListEntry[]>();
  const [detail, setDetail] = useState<ProjectDetail>();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showOpenExisting, setShowOpenExisting] = useState(false);
  const [openPath, setOpenPath] = useState('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();

  const refresh = () => { void api.listProjects().then((result) => setRecent(result.projects)).catch(() => setRecent([])); };
  useEffect(refresh, []);

  useEffect(() => {
    if (!currentProject) { setDetail(undefined); return; }
    void api.getProject(currentProject.id).then(setDetail).catch(() => setDetail(undefined));
  }, [currentProject?.id]);

  function handleCreated(project: ProjectSummary) {
    setShowNewProjectModal(false);
    onOpenProject(project);
    refresh();
    navigate('ai-builder');
  }

  async function openExisting() {
    const path = openPath.trim();
    if (!path) return;
    setOpening(true);
    setOpenError(undefined);
    try {
      const project = await api.openProject(path);
      onOpenProject(project);
      setOpenPath('');
      setShowOpenExisting(false);
      refresh();
      navigate('ai-builder');
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : 'Failed to open project.');
    } finally {
      setOpening(false);
    }
  }

  async function switchTo(project: ProjectListEntry) {
    const opened = await api.openProject(project.path, project.name);
    onOpenProject(opened);
    refresh();
  }

  if (!restored) {
    return <div className="view projects-view"><h1>Projects</h1><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="view projects-view">
      <div className="view-header-row">
        <h1>Projects</h1>
        <button onClick={() => setShowNewProjectModal(true)}>+ New Project</button>
      </div>

      {!currentProject && (
        <section className="empty-hero">
          <h2>No project yet</h2>
          <p className="muted">Every project is just a directory KubeVerse manages for you on this machine - nothing is uploaded anywhere.</p>
          <div className="settings-actions">
            <button onClick={() => setShowNewProjectModal(true)}>+ New Project</button>
            <button onClick={() => setShowOpenExisting((value) => !value)}>Open Existing Project</button>
          </div>
        </section>
      )}

      {currentProject && (
        <section className="settings-card project-detail-card">
          <h2>Current project</h2>
          <p className="project-dashboard-name">{currentProject.name}</p>
          <dl>
            <dt>Created</dt><dd>{detail ? new Date(detail.generatedState.lastCompiledAt ?? currentProject.lastOpenedAt).toLocaleString() : '…'}</dd>
            <dt>Services</dt><dd>{detail?.generatedState.spec?.services.length ?? 0}</dd>
            <dt>Status</dt>
            <dd>{detail?.generatedState.lastDeployedAt ? 'Running' : detail?.generatedState.lastGeneratedAt ? 'Generated' : detail?.generatedState.spec ? 'Compiled' : 'Ready'}</dd>
          </dl>
          <div className="settings-actions">
            <button onClick={() => navigate('ai-builder')}>Open Project</button>
            <button onClick={() => navigate('playground')}>Open Playground</button>
            <button onClick={() => navigate('architectures')} disabled={!detail?.generatedState.spec}>View Architecture</button>
          </div>
        </section>
      )}

      {showOpenExisting && (
        <section className="settings-card">
          <h2>Open existing project</h2>
          <p className="muted">Point KubeVerse at a project directory it doesn't already know about - for example, one created outside this machine's usual workspace.</p>
          <label>Directory path<input value={openPath} onChange={(event) => setOpenPath(event.target.value)} placeholder="/path/to/existing-kubeverse-project" /></label>
          <div className="settings-actions">
            <button onClick={() => void openExisting()} disabled={!openPath.trim() || opening}>{opening ? 'Opening…' : 'Open'}</button>
            <button onClick={() => setShowOpenExisting(false)} disabled={opening}>Cancel</button>
          </div>
          {openError && <p className="error">{openError}</p>}
        </section>
      )}
      {currentProject && !showOpenExisting && (
        <p className="muted"><button className="link-button" onClick={() => setShowOpenExisting(true)}>Open an existing project directory…</button></p>
      )}

      <section className="settings-card">
        <h2>Recent projects</h2>
        {recent === undefined && <p className="muted">Loading…</p>}
        {recent?.length === 0 && <p className="muted">No projects yet.</p>}
        {recent && recent.length > 0 && (
          <div className="project-grid">
            {recent.map((project) => (
              <div key={project.id} className={project.id === currentProject?.id ? 'project-card active' : 'project-card'}>
                <strong>{project.name}</strong>
                <span className="muted">{project.architecture.compiled ? `${project.architecture.serviceCount ?? 0} services` : 'No architecture yet'}</span>
                <button onClick={() => void switchTo(project)}>{project.id === currentProject?.id ? 'Current' : 'Open'}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {showNewProjectModal && <NewProjectModal onClose={() => setShowNewProjectModal(false)} onCreated={handleCreated} />}
    </div>
  );
}
