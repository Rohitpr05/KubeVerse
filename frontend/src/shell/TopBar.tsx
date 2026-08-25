export function TopBar({ backendOnline, installationId }: { backendOnline: boolean; installationId?: string }) {
  return (
    <header className="topbar">
      <div className="brand"><strong>KubeVerse</strong></div>
      <div className="topbar-right">
        {installationId && <span className="install-id">ID: {installationId}</span>}
        <span className="connection"><span className={backendOnline ? 'online-dot' : 'offline-dot'} /> {backendOnline ? 'Local Ready' : 'Backend Unreachable'}</span>
      </div>
    </header>
  );
}
