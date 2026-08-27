import { useCallback, useEffect, useState } from 'react';
import { api, type EnvironmentStatus, type Identity, type PublicSettings } from '../api';
import { checkForUpdates, downloadUpdate, getUpdateState, isDesktopApp, onUpdateState, quitAndInstall } from '../desktop';
import { primaryAction, settingsStatusText, type UpdateState } from '../updateLogic';

export function SettingsView() {
  const [identity, setIdentity] = useState<Identity>();
  const [settings, setSettings] = useState<PublicSettings>();
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [backendReady, setBackendReady] = useState<boolean>();
  const [kubernetesReady, setKubernetesReady] = useState<boolean>();
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saveMessage, setSaveMessage] = useState<string>();
  const [testMessage, setTestMessage] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [updateBusy, setUpdateBusy] = useState(false);

  // Reused by the initial load and the Recheck button - the same real
  // probes the desktop first-launch checklist uses (OnboardingView.tsx),
  // never a second detection mechanism.
  const checkEnvironment = useCallback(() => {
    void api.getHealth().then(() => setBackendReady(true)).catch(() => setBackendReady(false));
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
    void api.getReady().then((ready) => setKubernetesReady(ready.status === 'ready')).catch(() => setKubernetesReady(false));
  }, []);

  useEffect(() => {
    void api.getIdentity().then(setIdentity).catch(() => undefined);
    void api.getSettings().then((value) => { setSettings(value); setModel(value.model); }).catch(() => undefined);
    checkEnvironment();
    // Environment checks used to run exactly once (mount + manual Recheck),
    // so opening Settings while Docker/Kubernetes was still starting up
    // (a real, common case - not a rare edge case) froze the badges on
    // whatever was true at that one instant, with nothing to self-correct
    // once the cluster actually became reachable a few seconds later
    // (confirmed live: Playground showed a fully healthy, connected cluster
    // at the same moment Settings still said "Kubernetes: Unavailable").
    // A slow poll - same cadence as App.tsx's own backend-identity check -
    // fixes that without turning this into tight polling.
    const interval = setInterval(checkEnvironment, 15_000);
    return () => clearInterval(interval);
  }, [checkEnvironment]);

  // Manual "Check for Updates" (Phase 3B, §14: "plus manually from
  // Settings") - a no-op in browser dev mode, since isDesktopApp() gates the
  // section below entirely. Unlike UpdateBanner.tsx's silent background
  // check, a manual click here always shows its real result, including
  // "up to date" or a real error - the user explicitly asked.
  useEffect(() => {
    if (!isDesktopApp()) return;
    void getUpdateState().then(setUpdateState);
    return onUpdateState(setUpdateState);
  }, []);

  async function save() {
    setSaveMessage(undefined);
    try {
      const patch: { model: string; apiKey?: string } = { model };
      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      const next = await api.saveSettings(patch);
      setSettings(next);
      setApiKey('');
      setSaveMessage('Saved.');
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestMessage(undefined);
    try {
      const result = await api.testConnection();
      setTestMessage(result.valid ? 'Connection succeeded.' : (result.message ?? 'Connection failed.'));
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setTesting(false);
    }
  }

  async function runUpdateAction() {
    const action = primaryAction(updateState);
    setUpdateBusy(true);
    try {
      if (action === 'download') await downloadUpdate();
      else if (action === 'restart') await quitAndInstall();
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <div className="view settings-view">
      <h1>Settings</h1>

      <section className="settings-card">
        <h2>AI Provider</h2>
        <label>Provider<select value="openrouter" disabled><option value="openrouter">OpenRouter</option></select></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4o-mini" /></label>
        <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? '••••••••••••••••••••' : 'sk-or-...'} /></label>
        <p className="muted">Your API key is stored locally on this machine, at <code>~/.kubeverse/settings.json</code>. It is never committed to a project, never sent to KubeVerse, and only ever sent to the AI provider you configure here. A production desktop build will move this to OS keychain storage.</p>
        <div className="settings-actions">
          <button onClick={() => void save()}>Save</button>
          <button onClick={() => void testConnection()} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
        </div>
        {saveMessage && <p className="muted">{saveMessage}</p>}
        {testMessage && <p className="muted">{testMessage}</p>}
      </section>

      <section className="settings-card">
        <h2>Local environment</h2>
        <p className="muted">Real checks against this machine - never fabricated. If something a generated project needs isn't available, it's shown here plainly.</p>
        <div className="environment-row">
          <span className={backendReady ? 'status-badge ok' : backendReady === false ? 'status-badge error' : 'status-badge'}>Backend: {backendReady === undefined ? 'Checking…' : backendReady ? 'Ready' : 'Unreachable'}</span>
        </div>
        <div className="environment-row">
          <span className={environment?.docker.available ? 'status-badge ok' : 'status-badge error'}>Docker: {environment ? (environment.docker.available ? 'Available' : 'Unavailable') : 'Checking…'}</span>
          <span className="muted">{environment && (environment.docker.available ? environment.docker.version ?? 'unknown version' : environment.docker.error ?? 'not detected — install or start Docker Desktop to build/run generated projects')}</span>
        </div>
        <div className="environment-row">
          <span className={kubernetesReady ? 'status-badge ok' : kubernetesReady === false ? 'status-badge error' : 'status-badge'}>Kubernetes: {kubernetesReady === undefined ? 'Checking…' : kubernetesReady ? 'Connected' : 'Unavailable'}</span>
          <span className="muted">{kubernetesReady === false && 'your cluster is currently unreachable — start or enable Kubernetes and recheck'}</span>
        </div>
        <div className="environment-row">
          <span className={environment?.kubernetes.available ? 'status-badge ok' : 'status-badge error'}>kubectl: {environment ? (environment.kubernetes.available ? 'Available' : 'Missing') : 'Checking…'}</span>
          <span className="muted">{environment && (environment.kubernetes.available ? `context: ${environment.kubernetes.context ?? 'unknown'}${environment.kubernetes.server ? ` · ${environment.kubernetes.server}` : ''}` : environment.kubernetes.error ?? 'kubectl was not found on PATH')}</span>
        </div>
        <div className="settings-actions">
          <button onClick={checkEnvironment}>Recheck</button>
        </div>
      </section>

      {isDesktopApp() && (
        <section className="settings-card">
          <h2>Updates</h2>
          <p className="muted">{settingsStatusText(updateState)}</p>
          <div className="settings-actions">
            <button onClick={() => void checkForUpdates()} disabled={updateState.status === 'checking'}>
              {updateState.status === 'checking' ? 'Checking…' : 'Check for Updates'}
            </button>
            {primaryAction(updateState) && (
              <button onClick={() => void runUpdateAction()} disabled={updateBusy}>
                {primaryAction(updateState) === 'download' ? (updateBusy ? 'Starting…' : 'Download Update') : 'Restart and Update'}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="settings-card">
        <h2>Application identity</h2>
        <p>KubeVerse · {identity?.installationId ?? '…'}</p>
        <p className="muted">Generated once per local installation. Not a Firebase UID or any external account identifier.</p>
      </section>
    </div>
  );
}
