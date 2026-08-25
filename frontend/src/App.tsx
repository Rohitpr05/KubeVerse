import { useEffect, useState } from 'react';
import { Sidebar, type ViewId } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { PlaygroundView } from './views/PlaygroundView';
import { AIBuilderView } from './views/AIBuilderView';
import { ArchitecturesView } from './views/ArchitecturesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { api, type ProjectSummary } from './api';

export function App() {
  const [view, setView] = useState<ViewId>('playground');
  const [backendOnline, setBackendOnline] = useState(true);
  const [installationId, setInstallationId] = useState<string>();
  const [currentProject, setCurrentProject] = useState<ProjectSummary>();

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

  return (
    <main className="app-shell">
      <TopBar backendOnline={backendOnline} installationId={installationId} />
      <div className="shell-body">
        <Sidebar active={view} onSelect={setView} />
        <div className="shell-content">
          {view === 'playground' && <PlaygroundView />}
          {view === 'ai-builder' && <AIBuilderView currentProject={currentProject} />}
          {view === 'architectures' && <ArchitecturesView currentProject={currentProject} />}
          {view === 'projects' && <ProjectsView currentProject={currentProject} onOpenProject={setCurrentProject} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </div>
    </main>
  );
}
