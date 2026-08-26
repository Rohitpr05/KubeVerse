import { useEffect, useRef, useState } from 'react';
import { api, type ArchitectureSpecView, type EnvironmentStatus, type ExecutionResult, type GeneratedFileRecord, type ProjectSummary } from '../api';
import type { ViewId } from '../shell/Sidebar';
import { ArchitecturePreview } from '../components/ArchitecturePreview';
import { GeneratedFileTree } from '../components/GeneratedFileTree';
import { GenerationProgress, type Stage } from '../components/GenerationProgress';
import { NewProjectModal } from '../components/NewProjectModal';

const EXAMPLE = `# E-commerce demo

Frontend:
- Node.js
- port 3000

API:
- Node.js
- port 4000

Database:
- MongoDB
- persistent storage

Frontend calls API.
API calls MongoDB.`;

const COMPILE_STAGE_DEFS: { key: string; label: string }[] = [
  { key: 'reading', label: 'Reading architecture' },
  { key: 'sending', label: 'Sending architecture to AI' },
  { key: 'ai', label: 'Generating architecture' },
  { key: 'validating', label: 'Validating architecture' },
];

const GENERATE_STAGE_DEFS: { key: string; label: string }[] = [
  { key: 'services', label: 'Generating services' },
  { key: 'docker', label: 'Generating Docker configuration' },
  { key: 'kubernetes', label: 'Generating Kubernetes manifests' },
];

function freshStages(defs: { key: string; label: string }[]): Stage[] {
  return defs.map((def) => ({ ...def, status: 'pending' }));
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return <li className={done ? 'checklist-item done' : 'checklist-item'}>{done ? '✓' : '—'} {label}</li>;
}

export function AIBuilderView({ currentProject, navigate, onProjectCreated }: {
  currentProject: ProjectSummary | undefined;
  navigate: (view: ViewId) => void;
  onProjectCreated: (project: ProjectSummary) => void;
}) {
  const [source, setSource] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compileStages, setCompileStages] = useState<Stage[]>();
  const [compileErrors, setCompileErrors] = useState<string[]>();
  const [compiledSpec, setCompiledSpec] = useState<ArchitectureSpecView>();
  const [generating, setGenerating] = useState(false);
  const [generateStages, setGenerateStages] = useState<Stage[]>();
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFileRecord[]>();
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [dockerRunning, setDockerRunning] = useState(false);
  const [dockerResult, setDockerResult] = useState<ExecutionResult>();
  const [dockerStarted, setDockerStarted] = useState(false);
  const [k8sRunning, setK8sRunning] = useState(false);
  const [k8sResult, setK8sResult] = useState<ExecutionResult>();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bumped whenever the active project changes (or a new compile/generate
  // starts). An in-flight request captures the epoch it was started under;
  // if the epoch has moved on by the time it resolves - the user switched to
  // a different project, or started a fresh attempt - its result is
  // discarded instead of being applied to what's now on screen. Without
  // this, a slow compile for Project A that resolves after the user has
  // already switched to Project B could silently overwrite B's view with
  // A's result.
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    setCompileStages(undefined);
    setGenerateStages(undefined);
    setCompileErrors(undefined);
    setDockerResult(undefined);
    setK8sResult(undefined);
    setDockerStarted(false);
    setCompiling(false);
    setGenerating(false);
    if (!currentProject) return;
    void api.getProject(currentProject.id).then((detail) => {
      setSource(detail.architecture);
      setCompiledSpec(detail.generatedState.spec);
      setGeneratedFiles(detail.generatedState.files);
    }).catch(() => undefined);
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
  }, [currentProject?.id]);

  async function compile() {
    if (!currentProject) return;
    const epoch = ++epochRef.current;
    const setStage = (key: string, status: Stage['status'], error?: string) => {
      if (epochRef.current !== epoch) return;
      setCompileStages((stages) => stages?.map((stage) => (stage.key === key ? { ...stage, status, error } : stage)));
    };

    setCompiling(true);
    setCompileStages(freshStages(COMPILE_STAGE_DEFS));
    setCompileErrors(undefined);
    setCompiledSpec(undefined);
    setGeneratedFiles(undefined);
    setGenerateStages(undefined);

    setStage('reading', 'done');
    setStage('sending', 'done');
    setStage('ai', 'active');
    try {
      const outcome = await api.compileArchitecture(currentProject.id, source);
      if (epochRef.current !== epoch) return;
      if (outcome.success) {
        setStage('ai', 'done');
        setStage('validating', 'done');
        setCompiledSpec(outcome.spec);
      } else {
        const message = (outcome.errors ?? ['Compilation failed.']).join('; ');
        setStage('ai', 'error', message);
        setCompileErrors(outcome.errors ?? ['Compilation failed.']);
      }
    } catch (error) {
      if (epochRef.current !== epoch) return;
      const message = error instanceof Error ? error.message : 'Compilation failed.';
      setStage('ai', 'error', message);
      setCompileErrors([message]);
    } finally {
      if (epochRef.current === epoch) setCompiling(false);
    }
  }

  async function generate() {
    if (!currentProject) return;
    const epoch = ++epochRef.current;
    const setStage = (key: string, status: Stage['status'], error?: string) => {
      if (epochRef.current !== epoch) return;
      setGenerateStages((stages) => stages?.map((stage) => (stage.key === key ? { ...stage, status, error } : stage)));
    };

    setGenerating(true);
    setGenerateStages(freshStages(GENERATE_STAGE_DEFS));
    GENERATE_STAGE_DEFS.forEach((def) => setStage(def.key, 'active'));
    try {
      const result = await api.generateProject(currentProject.id);
      if (epochRef.current !== epoch) return;
      GENERATE_STAGE_DEFS.forEach((def) => setStage(def.key, 'done'));
      setGeneratedFiles(result.files);
    } catch (error) {
      if (epochRef.current !== epoch) return;
      const message = error instanceof Error ? error.message : 'Generation failed.';
      setStage('services', 'error', message);
    } finally {
      if (epochRef.current === epoch) setGenerating(false);
    }
  }

  async function startDocker() {
    if (!currentProject) return;
    if (!window.confirm('Run `docker compose up -d --build` in this project\'s docker/ folder?')) return;
    setDockerRunning(true);
    setDockerResult(undefined);
    try {
      const result = await api.dockerUp(currentProject.id);
      setDockerResult(result);
      setDockerStarted(result.ok);
    } catch (error) {
      setDockerResult({ ok: false, output: error instanceof Error ? error.message : 'Failed to start Docker Compose.' });
    } finally {
      setDockerRunning(false);
    }
  }

  async function stopDocker() {
    if (!currentProject) return;
    setDockerRunning(true);
    try {
      const result = await api.dockerDown(currentProject.id);
      setDockerResult(result);
      if (result.ok) setDockerStarted(false);
    } catch (error) {
      setDockerResult({ ok: false, output: error instanceof Error ? error.message : 'Failed to stop Docker Compose.' });
    } finally {
      setDockerRunning(false);
    }
  }

  async function deployKubernetes() {
    if (!currentProject) return;
    if (!window.confirm('Run `kubectl apply -f kubernetes/ --recursive` against your current kubectl context?')) return;
    setK8sRunning(true);
    setK8sResult(undefined);
    try {
      setK8sResult(await api.kubernetesApply(currentProject.id));
    } catch (error) {
      setK8sResult({ ok: false, output: error instanceof Error ? error.message : 'Failed to apply Kubernetes manifests.' });
    } finally {
      setK8sRunning(false);
    }
  }

  function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function handleProjectCreated(project: ProjectSummary) {
    setShowNewProjectModal(false);
    onProjectCreated(project);
  }

  if (!currentProject) {
    return (
      <div className="view">
        <h1>AI Builder</h1>
        <p className="muted">Build a Kubernetes architecture from a simple architecture description.</p>
        <section className="empty-hero">
          <h2>Create a project to start</h2>
          <div className="settings-actions">
            <button onClick={() => setShowNewProjectModal(true)}>+ New Project</button>
            <button onClick={() => navigate('projects')}>Open Existing Project</button>
          </div>
        </section>
        {showNewProjectModal && <NewProjectModal onClose={() => setShowNewProjectModal(false)} onCreated={handleProjectCreated} />}
      </div>
    );
  }

  const hasServiceFiles = generatedFiles?.some((file) => file.path.startsWith('generated/')) ?? false;
  const hasDocker = generatedFiles?.some((file) => file.path === 'docker/docker-compose.yml') ?? false;
  const hasKubernetes = generatedFiles?.some((file) => file.path.startsWith('kubernetes/')) ?? false;

  return (
    <div className="view ai-builder-view">
      <div className="view-header-row">
        <div>
          <h1>AI Builder</h1>
          <p className="muted">Project: <strong>{currentProject.name}</strong></p>
        </div>
        <button onClick={() => setShowNewProjectModal(true)}>+ New Project</button>
      </div>

      <section className="settings-card">
        <h2>Step 1 — Describe your architecture</h2>
        <textarea
          className="architecture-input"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={EXAMPLE}
        />
        <div className="settings-actions">
          <input ref={fileInputRef} type="file" accept=".md,.txt" onChange={onFilePicked} style={{ display: 'none' }} />
          <button onClick={() => fileInputRef.current?.click()}>Upload architecture.md…</button>
          <button onClick={() => void compile()} disabled={compiling || !source.trim()}>{compiling ? 'Compiling…' : 'Compile Architecture'}</button>
        </div>
        {compileStages && <GenerationProgress title="Building architecture" stages={compileStages} />}
        {compileErrors && !compiling && (
          <div className="validation-errors">
            <p><strong>✗ Architecture compilation failed</strong> — the AI's proposal didn't pass schema validation, so nothing was accepted:</p>
            <ul>{compileErrors.map((message, index) => <li key={index} className="error">{message}</li>)}</ul>
            <div className="settings-actions"><button onClick={() => void compile()}>Retry</button></div>
          </div>
        )}
      </section>

      {compiledSpec && (
        <section className="settings-card">
          <h2>Step 2 — Review architecture</h2>
          <ArchitecturePreview spec={compiledSpec} />
          <div className="settings-actions">
            <button onClick={() => void generate()} disabled={generating}>{generating ? 'Generating…' : 'Generate Project'}</button>
          </div>
          {generateStages && <GenerationProgress title="Generating project files" stages={generateStages} />}
          {generateStages?.some((stage) => stage.status === 'error') && !generating && (
            <div className="settings-actions"><button onClick={() => void generate()}>Retry</button></div>
          )}
        </section>
      )}

      {generatedFiles && generatedFiles.length > 0 && (
        <section className="settings-card">
          <h2>Step 3 — Generated</h2>
          <ul className="checklist">
            <ChecklistItem done label="Architecture validated" />
            <ChecklistItem done={hasServiceFiles} label="Service definitions generated" />
            <ChecklistItem done={hasDocker} label="Docker configuration generated" />
            <ChecklistItem done={hasKubernetes} label="Kubernetes manifests generated" />
            <ChecklistItem done label="Project generated" />
          </ul>
          <div className="settings-actions">
            <button onClick={() => navigate('projects')}>Open Project</button>
            <button onClick={() => navigate('playground')}>Open Playground</button>
          </div>

          <h3>Files</h3>
          <GeneratedFileTree projectId={currentProject.id} files={generatedFiles} />

          <h3>Run it</h3>
          <p className="muted">These run fixed, known commands (<code>docker compose up/down</code>, <code>kubectl apply</code>) scoped to this project's generated output - nothing else.</p>
          <div className="run-actions">
            <div className="run-action">
              <div className="settings-actions">
                <button onClick={() => void startDocker()} disabled={!hasDocker || dockerRunning || !environment?.docker.available}>
                  {dockerRunning ? 'Running…' : 'Start with Docker Compose'}
                </button>
                {dockerStarted && <button onClick={() => void stopDocker()} disabled={dockerRunning}>Stop</button>}
              </div>
              {!environment?.docker.available && <p className="muted">Docker is not available on this machine - see Settings.</p>}
              {dockerResult && <pre className={dockerResult.ok ? 'yaml execution-output' : 'yaml execution-output error'}>{dockerResult.output}</pre>}
            </div>
            <div className="run-action">
              <div className="settings-actions">
                <button onClick={() => void deployKubernetes()} disabled={!hasKubernetes || k8sRunning || !environment?.kubernetes.available}>
                  {k8sRunning ? 'Applying…' : 'Deploy to Kubernetes'}
                </button>
              </div>
              {!environment?.kubernetes.available && <p className="muted">kubectl is not available or has no context configured - see Settings.</p>}
              {k8sResult && <pre className={k8sResult.ok ? 'yaml execution-output' : 'yaml execution-output error'}>{k8sResult.output}</pre>}
              {k8sResult?.ok && <p className="muted">Check the <button className="link-button" onClick={() => navigate('playground')}>Playground</button> to see the resulting resources.</p>}
            </div>
          </div>
        </section>
      )}

      {showNewProjectModal && <NewProjectModal onClose={() => setShowNewProjectModal(false)} onCreated={handleProjectCreated} />}
    </div>
  );
}
