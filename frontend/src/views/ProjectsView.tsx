import { useEffect, useState } from 'react';
import { api, type ProjectSummary } from '../api';

export function ProjectsView({ currentProject, onOpenProject }: {
  currentProject: ProjectSummary | undefined;
  onOpenProject: (project: ProjectSummary) => void;
}) {
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const refresh = () => { void api.listProjects().then((result) => setRecent(result.projects)).catch(() => undefined); };
  useEffect(refresh, []);

  async function openProject(targetPath: string, targetName?: string) {
    setError(undefined);
    setOpening(true);
    try {
      const project = await api.openProject(targetPath, targetName);
      onOpenProject(project);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to open project.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="view projects-view">
      <h1>Projects</h1>
      <p className="muted">A project is a local directory. KubeVerse never stores project content anywhere else - opening or creating one just points KubeVerse at that folder.</p>

      <section className="settings-card">
        <h2>Open or create a project</h2>
        <label>Directory path<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Users/you/my-kubeverse-project" /></label>
        <label>Name (new projects only)<input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-kubeverse-project" /></label>
        <div className="settings-actions">
          <button disabled={!path.trim() || opening} onClick={() => void openProject(path.trim(), name.trim() || undefined)}>{opening ? 'Opening…' : 'Open / Create'}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="settings-card">
        <h2>Recent projects</h2>
        {recent.length === 0 && <p className="muted">No projects opened yet.</p>}
        <ul className="project-list">
          {recent.map((project) => (
            <li key={project.id} className={project.id === currentProject?.id ? 'active' : ''}>
              <div>
                <strong>{project.name}</strong>
                <div className="muted">{project.path}</div>
              </div>
              <button onClick={() => void openProject(project.path, project.name)}>{project.id === currentProject?.id ? 'Current' : 'Open'}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
