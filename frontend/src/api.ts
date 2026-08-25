// Thin fetch helpers for KubeVerse's local backend routes (identity, settings,
// environment, projects, architecture). The observer routes used by
// PlaygroundView stay as plain inline fetches - they predate this module and
// don't need it.

export interface Identity {
  installationId: string;
  createdAt: string;
}

export interface PublicSettings {
  aiProvider: 'openrouter';
  model: string;
  hasApiKey: boolean;
}

export interface EnvironmentStatus {
  docker: { available: boolean; version?: string; error?: string };
  kubernetes: { available: boolean; context?: string; server?: string; error?: string };
  checkedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface ArchitectureStatus {
  compiled: boolean;
  name?: string;
  serviceCount?: number;
  lastCompiledAt?: string;
  lastGeneratedAt?: string;
  generatedFileCount?: number;
}

export interface ProjectListEntry extends ProjectSummary {
  architecture: ArchitectureStatus;
}

// Mirrors backend/src/architecture/schema.ts's zod-inferred shape. This is a
// display-only type duplication in a separate npm workspace with no shared
// package for the NAM (only the Kubernetes observer contract is shared) -
// the backend's zod schema remains the only place this shape is validated.
export interface ArchitectureServiceSpec {
  name: string;
  type: string;
  runtime: string;
  port: number;
  protocol: string;
  command?: string;
  env: Record<string, string>;
  dependsOn: string[];
  replicas: number;
  resources: { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } };
  healthCheck: { path: string; intervalSeconds: number; timeoutSeconds: number };
  volume?: { name: string; mountPath: string; sizeGi: number };
  expose: boolean;
}

export interface ArchitectureTrafficEdge {
  from: string;
  to: string;
  description?: string;
}

export interface ArchitectureSpecView {
  name: string;
  version: number;
  services: ArchitectureServiceSpec[];
  traffic: ArchitectureTrafficEdge[];
}

export interface GeneratedFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ProjectDetail extends ProjectSummary {
  architecture: string;
  generatedState: {
    lastCompiledAt?: string;
    lastGeneratedAt?: string;
    spec?: ArchitectureSpecView;
    files?: GeneratedFileRecord[];
  };
}

export interface CompileOutcome {
  success: boolean;
  spec?: ArchitectureSpecView;
  errors?: string[];
  raw?: string;
}

export interface ExecutionResult {
  ok: boolean;
  output: string;
}

async function asJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  return body;
}

export const api = {
  getIdentity: () => fetch('/api/identity').then((response) => asJson<Identity>(response)),

  getSettings: () => fetch('/api/settings').then((response) => asJson<PublicSettings>(response)),
  saveSettings: (patch: { aiProvider?: string; model?: string; apiKey?: string }) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then((response) => asJson<PublicSettings>(response)),
  testConnection: () => fetch('/api/settings/test-connection', { method: 'POST' }).then((response) => asJson<{ valid: boolean; message?: string }>(response)),

  getEnvironment: () => fetch('/api/environment').then((response) => asJson<EnvironmentStatus>(response)),

  listProjects: () => fetch('/api/projects').then((response) => asJson<{ projects: ProjectListEntry[] }>(response)),
  openProject: (path: string, name?: string) =>
    fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, name }) }).then((response) => asJson<ProjectSummary>(response)),
  getProject: (id: string) => fetch(`/api/projects/${id}`).then((response) => asJson<ProjectDetail>(response)),
  getProjectFile: (id: string, path: string) =>
    fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`).then((response) => asJson<{ path: string; contents: string }>(response)),

  compileArchitecture: (projectId: string, source: string) =>
    fetch('/api/architecture/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, source }) }).then((response) => asJson<CompileOutcome>(response)),
  generateProject: (projectId: string) =>
    fetch('/api/architecture/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) }).then((response) => asJson<{ files: GeneratedFileRecord[] }>(response)),

  dockerUp: (projectId: string) => fetch(`/api/projects/${projectId}/docker/up`, { method: 'POST' }).then((response) => asJson<ExecutionResult>(response)),
  dockerDown: (projectId: string) => fetch(`/api/projects/${projectId}/docker/down`, { method: 'POST' }).then((response) => asJson<ExecutionResult>(response)),
  kubernetesApply: (projectId: string) => fetch(`/api/projects/${projectId}/kubernetes/apply`, { method: 'POST' }).then((response) => asJson<ExecutionResult>(response)),
};
