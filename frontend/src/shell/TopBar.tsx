import type { ProjectSummary } from '../api';
import kubeverseMark from '../assets/kubeverse-mark-on-dark.svg';
import { AccountMenu } from '../components/AccountMenu';

export function TopBar({ backendOnline, installationId, currentProject, onSwitchProject }: {
  backendOnline: boolean;
  installationId?: string;
  currentProject?: ProjectSummary;
  onSwitchProject: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand"><img src={kubeverseMark} alt="" width={20} height={20} className="brand-mark" /><strong>KubeVerse</strong></div>
        <button className="project-chip" onClick={onSwitchProject} title={currentProject?.path ?? 'No project open'}>
          {currentProject ? <>Project: <strong>{currentProject.name}</strong></> : 'No project open'}
        </button>
      </div>
      <div className="topbar-right">
        <span className="connection"><span className={backendOnline ? 'online-dot' : 'offline-dot'} /> {backendOnline ? 'Local Ready' : 'Backend Unreachable'}</span>
        {installationId && <span className="install-id">{installationId}</span>}
        <AccountMenu />
      </div>
    </header>
  );
}
