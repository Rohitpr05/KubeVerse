import { useEffect, useState } from 'react';
import { api, type ProjectDetail, type ProjectSummary } from '../api';

export function ArchitecturesView({ currentProject }: { currentProject: ProjectSummary | undefined }) {
  const [detail, setDetail] = useState<ProjectDetail>();

  useEffect(() => {
    if (!currentProject) { setDetail(undefined); return; }
    void api.getProject(currentProject.id).then(setDetail).catch(() => undefined);
  }, [currentProject?.id]);

  if (!currentProject) {
    return (
      <div className="view">
        <h1>Architectures</h1>
        <p className="muted">Open or create a project first, in the Projects tab.</p>
      </div>
    );
  }

  const { generatedState } = detail ?? {};
  return (
    <div className="view">
      <h1>Architectures</h1>
      <p className="muted">Read-only view of {currentProject.name}'s architecture source and compile/generate provenance. Edit and compile it from the AI Builder tab.</p>

      <section className="settings-card">
        <h2>architecture.md</h2>
        <pre className="yaml">{detail?.architecture ?? 'Loading…'}</pre>
      </section>

      <section className="settings-card">
        <h2>Provenance</h2>
        <dl>
          <dt>Last compiled</dt>
          <dd>{generatedState?.lastCompiledAt ?? 'Never'}</dd>
          <dt>Last generated</dt>
          <dd>{generatedState?.lastGeneratedAt ?? 'Never'}</dd>
          <dt>Generated files</dt>
          <dd>{generatedState?.files?.length ?? 0}</dd>
        </dl>
      </section>
    </div>
  );
}
