import { useEffect, useState } from 'react';
import { Sidebar, type ViewId } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { PlaygroundView } from './views/PlaygroundView';
import { AIBuilderView } from './views/AIBuilderView';
import { ArchitecturesView } from './views/ArchitecturesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { OnboardingView } from './views/OnboardingView';
import { UpdateBanner } from './components/UpdateBanner';
import { api, type ProjectSummary } from './api';
import { getSetupComplete, isDesktopApp } from './desktop';

const CURRENT_PROJECT_KEY = 'kubeverse.currentProjectId';

export function App() {
  const [view, setView] = useState<ViewId>('playground');
  const [backendOnline, setBackendOnline] = useState(true);
  const [installationId, setInstallationId] = useState<string>();
  const [currentProject, setCurrentProjectState] = useState<ProjectSummary>();
  const [restoredProject, setRestoredProject] = useState(false);
  // First-launch onboarding (Phase 3, §2/§6) is desktop-only and gates
  // everything else below it. Three states, not two: `undefined` means "the
  // persisted flag hasn't been read yet" - deliberately distinct from
  // `false`, so a *returning* desktop user (setupComplete already true on
  // disk) never sees so much as a flash of the onboarding screen while this
  // resolves. Browser dev mode short-circuits straight to `true` and never
  // calls the (desktop-only) bridge at all.
  const [setupComplete, setSetupComplete] = useState<boolean | undefined>(() => (isDesktopApp() ? undefined : true));

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    void getSetupComplete().then((complete) => { if (!cancelled) setSetupComplete(complete); });
    return () => { cancelled = true; };
  }, []);

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

  // Still reading the persisted flag (desktop only, and only for a brief
  // moment right after the window loads) - render nothing rather than a
  // flash of either the onboarding screen or the real app shell.
  if (setupComplete === undefined) return null;

  if (!setupComplete) return <OnboardingView onContinue={() => setSetupComplete(true)} />;

  return (
    <main className="app-shell">
      {isDesktopApp() && <UpdateBanner />}
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
