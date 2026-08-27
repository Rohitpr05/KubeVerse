// Thin fetch helpers for KubeVerse's local backend routes (identity, settings,
// environment, projects, architecture). The observer routes used by
// PlaygroundView stay as plain inline fetches - they predate this module and
// don't need it.
import type { LabExperiment } from '@kubeverse/shared';

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
  lastDeployedAt?: string;
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
    lastDeployedAt?: string;
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
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    // A 2xx response that isn't actually valid JSON is never a legitimate
    // success - it used to be silently swallowed into a fake `{}` "success"
    // here, which is exactly what masked a real bug: a request that missed
    // Vite's dev-server proxy list landed on Vite's own HTML SPA fallback
    // (200 OK) instead of the real backend, and every caller of this
    // function treated that as success with an empty body (see
    // vite.config.ts's proxy list and its comment on /health, /live, /ready).
    throw new Error(`Expected a JSON response but received something else (status ${response.status}).`);
  }
}

export const api = {
  getIdentity: () => fetch('/api/identity').then((response) => asJson<Identity>(response)),

  getSettings: () => fetch('/api/settings').then((response) => asJson<PublicSettings>(response)),
  saveSettings: (patch: { aiProvider?: string; model?: string; apiKey?: string }) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then((response) => asJson<PublicSettings>(response)),
  testConnection: () => fetch('/api/settings/test-connection', { method: 'POST' }).then((response) => asJson<{ valid: boolean; message?: string }>(response)),

  getEnvironment: () => fetch('/api/environment').then((response) => asJson<EnvironmentStatus>(response)),
  // /health only ever answers once the backend has actually started
  // listening (backend/src/server.ts) - used by the desktop first-launch
  // checklist (OnboardingView.tsx) as the real "KubeVerse backend" signal,
  // the same endpoint the Electron shell itself already polls before it
  // ever loads this page (desktop/src/backendProcess.js's waitForHealth).
  getHealth: () => fetch('/health').then((response) => asJson<{ status: string; service: string }>(response)),
  // /ready reflects the Kubernetes OBSERVER's actual live connection state
  // (no watch errors) - distinct from /api/environment's "kubernetes" field,
  // which only checks that the kubectl CLI + a context exist, not that the
  // cluster is genuinely reachable right now.
  getReady: () => fetch('/ready').then((response) => asJson<{ status: 'ready' | 'degraded' }>(response)),

  listProjects: () => fetch('/api/projects').then((response) => asJson<{ projects: ProjectListEntry[] }>(response)),
  // Primary creation path: KubeVerse picks the location automatically under
  // its dedicated local projects workspace (never inside the app's own
  // source tree) - the user only ever supplies a name.
  createProject: (name: string) =>
    fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((response) => asJson<ProjectSummary>(response)),
  // Secondary path: open (or create) a project at an explicit directory the
  // user chooses themselves.
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

  // Phase 2 Lab: narrow, project-scoped experiment operations
  // (backend/src/routes/lab.ts). Every mutating call here targets exactly
  // one resource the backend independently re-verifies belongs to this
  // project - the frontend never has (or needs) mutation authority beyond
  // what these specific endpoints expose.
  listExperiments: (projectId: string) => fetch(`/api/projects/${projectId}/lab/experiments`).then((response) => asJson<{ experiments: LabExperiment[] }>(response)),
  startTraffic: (projectId: string, body: { serviceNamespace: string; serviceName: string; requests: number; requestsPerSecond: number }) =>
    fetch(`/api/projects/${projectId}/lab/traffic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((response) => asJson<LabExperiment>(response)),
  cancelExperiment: (projectId: string, experimentId: string) =>
    fetch(`/api/projects/${projectId}/lab/experiments/${experimentId}/cancel`, { method: 'POST' }).then((response) => asJson<LabExperiment>(response)),
  failPod: (projectId: string, name: string, namespace: string) =>
    fetch(`/api/projects/${projectId}/lab/pods/${encodeURIComponent(name)}/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace }) })
      .then((response) => asJson<{ experiment: LabExperiment; result: ExecutionResult }>(response)),
  restartWorkload: (projectId: string, name: string, namespace: string) =>
    fetch(`/api/projects/${projectId}/lab/deployments/${encodeURIComponent(name)}/restart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace }) })
      .then((response) => asJson<{ experiment: LabExperiment; result: ExecutionResult }>(response)),
  scaleWorkload: (projectId: string, name: string, namespace: string, replicas: number) =>
    fetch(`/api/projects/${projectId}/lab/deployments/${encodeURIComponent(name)}/scale`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace, replicas }) })
      .then((response) => asJson<{ experiment: LabExperiment; result: ExecutionResult }>(response)),
};
