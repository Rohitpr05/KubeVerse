import { useEffect, useRef, useState } from 'react';
import { api, type ProjectSummary } from '../api';

interface GeneratedFileRecord { path: string; bytes: number; sha256: string; }

export function AIBuilderView({ currentProject }: { currentProject: ProjectSummary | undefined }) {
  const [source, setSource] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compileErrors, setCompileErrors] = useState<string[]>();
  const [compiledSpec, setCompiledSpec] = useState<unknown>();
  const [generating, setGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFileRecord[]>();
  const [generateError, setGenerateError] = useState<string>();
  const [previewPath, setPreviewPath] = useState<string>();
  const [previewContents, setPreviewContents] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentProject) return;
    void api.getProject(currentProject.id).then((detail) => {
      setSource(detail.architecture);
      setCompiledSpec(detail.generatedState.spec);
      setGeneratedFiles(detail.generatedState.files);
    }).catch(() => undefined);
  }, [currentProject?.id]);

  async function compile() {
    if (!currentProject) return;
    setCompiling(true);
    setCompileErrors(undefined);
    setCompiledSpec(undefined);
    try {
      const outcome = await api.compileArchitecture(currentProject.id, source);
      if (outcome.success) setCompiledSpec(outcome.spec);
      else setCompileErrors(outcome.errors ?? ['Compilation failed.']);
    } catch (error) {
      setCompileErrors([error instanceof Error ? error.message : 'Compilation failed.']);
    } finally {
      setCompiling(false);
    }
  }

  async function generate() {
    if (!currentProject) return;
    setGenerating(true);
    setGenerateError(undefined);
    try {
      const result = await api.generateProject(currentProject.id);
      setGeneratedFiles(result.files);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  async function preview(path: string) {
    if (!currentProject) return;
    setPreviewPath(path);
    setPreviewContents(undefined);
    try {
      const file = await api.getProjectFile(currentProject.id, path);
      setPreviewContents(file.contents);
    } catch (error) {
      setPreviewContents(error instanceof Error ? error.message : 'Failed to load file.');
    }
  }

  function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  if (!currentProject) {
    return (
      <div className="view">
        <h1>AI Builder</h1>
        <p className="muted">Open or create a project first, in the Projects tab.</p>
      </div>
    );
  }

  return (
    <div className="view ai-builder-view">
      <h1>AI Builder</h1>
      <p className="muted">Project: <strong>{currentProject.name}</strong> ({currentProject.path})</p>

      <section className="settings-card">
        <h2>architecture.md</h2>
        <textarea className="architecture-input" value={source} onChange={(event) => setSource(event.target.value)} rows={14} spellCheck={false} />
        <div className="settings-actions">
          <input ref={fileInputRef} type="file" accept=".md,.txt" onChange={onFilePicked} style={{ display: 'none' }} />
          <button onClick={() => fileInputRef.current?.click()}>Choose file…</button>
          <button onClick={() => void compile()} disabled={compiling || !source.trim()}>{compiling ? 'Compiling…' : 'Compile Architecture'}</button>
        </div>
      </section>

      {compileErrors && (
        <section className="settings-card">
          <h2>Validation errors</h2>
          <ul className="project-list">{compileErrors.map((message, index) => <li key={index} className="error">{message}</li>)}</ul>
        </section>
      )}

      {Boolean(compiledSpec) && (
        <section className="settings-card">
          <h2>Structured architecture specification</h2>
          <pre className="yaml">{JSON.stringify(compiledSpec, null, 2)}</pre>
          <div className="settings-actions">
            <button onClick={() => void generate()} disabled={generating}>{generating ? 'Generating…' : 'Generate Project'}</button>
          </div>
          {generateError && <p className="error">{generateError}</p>}
        </section>
      )}

      {generatedFiles && generatedFiles.length > 0 && (
        <section className="settings-card">
          <h2>Generated files</h2>
          <div className="generated-file-browser">
            <ul className="project-list file-tree">
              {generatedFiles.map((file) => (
                <li key={file.path} className={file.path === previewPath ? 'active' : ''}>
                  <button className="file-tree-item" onClick={() => void preview(file.path)}>{file.path}</button>
                </li>
              ))}
            </ul>
            {previewPath && <pre className="yaml file-preview">{previewContents ?? 'Loading…'}</pre>}
          </div>
        </section>
      )}
    </div>
  );
}
