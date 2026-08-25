import { useEffect, useState } from 'react';
import { api, type EnvironmentStatus, type Identity, type PublicSettings } from '../api';

export function SettingsView() {
  const [identity, setIdentity] = useState<Identity>();
  const [settings, setSettings] = useState<PublicSettings>();
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saveMessage, setSaveMessage] = useState<string>();
  const [testMessage, setTestMessage] = useState<string>();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api.getIdentity().then(setIdentity).catch(() => undefined);
    void api.getSettings().then((value) => { setSettings(value); setModel(value.model); }).catch(() => undefined);
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
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

  return (
    <div className="view settings-view">
      <h1>Settings</h1>

      <section className="settings-card">
        <h2>AI Provider</h2>
        <label>Provider<select value="openrouter" disabled><option value="openrouter">OpenRouter</option></select></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4o-mini" /></label>
        <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? '••••••••••••••••••••' : 'sk-or-...'} /></label>
        <p className="muted">Stored locally at <code>~/.kubeverse/settings.json</code>, never committed to this project or sent anywhere but the configured provider. A production desktop build will move this to OS keychain storage.</p>
        <div className="settings-actions">
          <button onClick={() => void save()}>Save</button>
          <button onClick={() => void testConnection()} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
        </div>
        {saveMessage && <p className="muted">{saveMessage}</p>}
        {testMessage && <p className="muted">{testMessage}</p>}
      </section>

      <section className="settings-card">
        <h2>Local environment</h2>
        <dl>
          <dt>Docker</dt>
          <dd>{environment ? (environment.docker.available ? `Available (${environment.docker.version ?? 'unknown version'})` : `Unavailable — ${environment.docker.error ?? 'not detected'}`) : 'Checking…'}</dd>
          <dt>Kubernetes</dt>
          <dd>{environment ? (environment.kubernetes.available ? `Available (context: ${environment.kubernetes.context ?? 'unknown'})` : `Unavailable — ${environment.kubernetes.error ?? 'not detected'}`) : 'Checking…'}</dd>
        </dl>
      </section>

      <section className="settings-card">
        <h2>Application identity</h2>
        <p>KubeVerse · {identity?.installationId ?? '…'}</p>
        <p className="muted">Generated once per local installation. Not a Firebase UID or any external account identifier.</p>
      </section>
    </div>
  );
}
