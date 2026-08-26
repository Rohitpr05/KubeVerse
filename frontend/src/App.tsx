import { useEffect, useState } from 'react';
import { Sidebar, type ViewId } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { PlaygroundView } from './views/PlaygroundView';
import { AIBuilderView } from './views/AIBuilderView';
import { ArchitecturesView } from './views/ArchitecturesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { api, type ProjectSummary } from './api';

const CURRENT_PROJECT_KEY = 'kubeverse.currentProjectId';

export function App() {
  const [view, setView] = useState<ViewId>('playground');
  const [backendOnline, setBackendOnline] = useState(true);
  const [installationId, setInstallationId] = useState<string>();
  const [currentProject, setCurrentProjectState] = useState<ProjectSummary>();
  const [restoredProject, setRestoredProject] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void api.getIdentity()
        .then((identity) => { if (!cancelled) { setBackendOnline(true); setInstallationId(identity.installationId); } })
        .catch(() => { if (!cancelled) setBackendOnline(false); });
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Restore whichever project the user last had open - a per-browser
  // convenience, not a source of truth. Every project's own
  // .kubeverse/metadata.json on disk remains authoritative regardless.
  useEffect(() => {
    let cancelled = false;
    void api.listProjects().then(({ projects }) => {
      if (cancelled || projects.length === 0) return;
      const rememberedId = window.localStorage.getItem(CURRENT_PROJECT_KEY);
      const remembered = rememberedId ? projects.find((project) => project.id === rememberedId) : undefined;
      setCurrentProjectState(remembered ?? projects[0]);
    }).catch(() => undefined).finally(() => { if (!cancelled) setRestoredProject(true); });
    return () => { cancelled = true; };
  }, []);

  function setCurrentProject(project: ProjectSummary | undefined) {
    setCurrentProjectState(project);
    if (project) window.localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
    else window.localStorage.removeItem(CURRENT_PROJECT_KEY);
  }

  return (
    <main className="app-shell">
      <TopBar backendOnline={backendOnline} installationId={installationId} currentProject={currentProject} onSwitchProject={() => setView('projects')} />
      <div className="shell-body">
        <Sidebar active={view} onSelect={setView} />
        <div className="shell-content">
          {view === 'playground' && <PlaygroundView currentProject={currentProject} navigate={setView} />}
          {view === 'ai-builder' && <AIBuilderView currentProject={currentProject} navigate={setView} onProjectCreated={setCurrentProject} />}
          {view === 'architectures' && <ArchitecturesView currentProject={currentProject} onOpenProject={setCurrentProject} navigate={setView} />}
          {view === 'projects' && <ProjectsView currentProject={currentProject} onOpenProject={setCurrentProject} navigate={setView} restored={restoredProject} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </div>
    </main>
  );
}
