// Local project workspace: a project is a normal directory on disk, identified
// by a UUIDv7 stored in its own .kubeverse/metadata.json. KubeVerse never stores
// project content anywhere else; the ~/.kubeverse recent-projects index below
// holds only paths, as a convenience MRU list, not a source of truth.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { kubeversePath, projectsRoot } from './local/paths.js';
import { uuidv7 } from './local/uuidv7.js';
import type { ArchitectureSpec } from './architecture/schema.js';

export interface ProjectMetadata {
  projectId: string;
  name: string;
  createdAt: string;
  schemaVersion: 1;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface GeneratedFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface GeneratedState {
  lastCompiledAt?: string;
  lastGeneratedAt?: string;
  lastDeployedAt?: string;
  spec?: ArchitectureSpec;
  files?: GeneratedFileRecord[];
}

const ARCHITECTURE_TEMPLATE = `# My Application

## Frontend
Node.js application
Port 3000

## Backend
Node.js API
Port 4000

## Traffic
Frontend -> Backend
`;

function metadataPath(projectPath: string): string {
  return join(projectPath, '.kubeverse', 'metadata.json');
}

function generatedStatePath(projectPath: string): string {
  return join(projectPath, '.kubeverse', 'generated-state.json');
}

function recentProjectsPath(): string {
  return kubeversePath('recent-projects.json');
}

interface RecentEntry {
  path: string;
  lastOpenedAt: string;
}

export function listRecentProjects(): RecentEntry[] {
  const path = recentProjectsPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RecentEntry[];
  } catch {
    return [];
  }
}

function recordRecentProject(projectPath: string): void {
  const list = listRecentProjects().filter((entry) => entry.path !== projectPath);
  list.unshift({ path: projectPath, lastOpenedAt: new Date().toISOString() });
  writeFileSync(recentProjectsPath(), JSON.stringify(list.slice(0, 20), null, 2));
}

// Keeps a project name filesystem-safe (no path separators or characters
// Windows forbids in a path segment) while preserving spaces/casing for
// readability - project *directory* names are meant to stay human-readable
// ("My E-Commerce App"), unlike the fully-slugified Kubernetes label values
// in ownership.ts, which have much stricter constraints.
function safeDirectoryName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
  return (cleaned || 'Untitled Project').slice(0, 100);
}

// Creates a brand-new project under KubeVerse's dedicated local projects
// workspace (backend/src/local/paths.ts's projectsRoot() - never inside the
// KubeVerse application/source tree) from a name alone - the primary project
// creation path (KUBEVERSE_MASTER_SPEC.md's local-first project workspace).
// A name collision gets a numeric suffix rather than silently reusing an
// existing directory, so two differently-created projects are never merged.
export function createProject(name: string): ProjectSummary {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Project name is required.');

  const root = projectsRoot();
  const base = safeDirectoryName(trimmedName);
  let candidate = base;
  let suffix = 2;
  while (existsSync(join(root, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return openOrCreateProject(join(root, candidate), trimmedName);
}

// Opens a project directory, creating the .kubeverse/ + generated/ scaffold and
// a starter architecture.md if this is the first time KubeVerse has seen it.
export function openOrCreateProject(inputPath: string, name?: string): ProjectSummary {
  const projectPath = resolve(inputPath);
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(projectPath, '.kubeverse', 'cache'), { recursive: true });
  mkdirSync(join(projectPath, 'generated'), { recursive: true });

  const metaPath = metadataPath(projectPath);
  let metadata: ProjectMetadata;
  if (existsSync(metaPath)) {
    metadata = JSON.parse(readFileSync(metaPath, 'utf8')) as ProjectMetadata;
  } else {
    metadata = {
      projectId: uuidv7(),
      // resolve()'s output uses the OS's own separator ('\' on Windows) -
      // splitting on a hardcoded '/' would return the entire absolute path
      // as the project name on Windows instead of just the trailing
      // directory name. basename() is the cross-platform-correct way to get
      // the last path segment regardless of separator.
      name: name?.trim() || basename(projectPath) || 'project',
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  }

  const architecturePath = join(projectPath, 'architecture.md');
  if (!existsSync(architecturePath)) writeFileSync(architecturePath, ARCHITECTURE_TEMPLATE);

  recordRecentProject(projectPath);
  return { id: metadata.projectId, name: metadata.name, path: projectPath, lastOpenedAt: new Date().toISOString() };
}

export function listProjectSummaries(): ProjectSummary[] {
  return listRecentProjects()
    .filter((entry) => existsSync(metadataPath(entry.path)))
    .map((entry) => {
      const metadata = JSON.parse(readFileSync(metadataPath(entry.path), 'utf8')) as ProjectMetadata;
      return { id: metadata.projectId, name: metadata.name, path: entry.path, lastOpenedAt: entry.lastOpenedAt };
    });
}

export function getProjectById(id: string): ProjectSummary | undefined {
  return listProjectSummaries().find((project) => project.id === id);
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

function summarizeArchitecture(state: GeneratedState): ArchitectureStatus {
  return {
    compiled: Boolean(state.spec),
    name: state.spec?.name,
    serviceCount: state.spec?.services.length,
    lastCompiledAt: state.lastCompiledAt,
    lastGeneratedAt: state.lastGeneratedAt,
    lastDeployedAt: state.lastDeployedAt,
    generatedFileCount: state.files?.length,
  };
}

// Used by the Projects/Architectures list views so they can show real compile
// and generation status without an N+1 fetch per project from the frontend.
export function listProjectsWithArchitecture(): ProjectListEntry[] {
  return listProjectSummaries().map((project) => ({
    ...project,
    architecture: summarizeArchitecture(readGeneratedState(project.path)),
  }));
}

export function readArchitectureSource(projectPath: string): string {
  const path = join(projectPath, 'architecture.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function writeArchitectureSource(projectPath: string, source: string): void {
  writeFileSync(join(projectPath, 'architecture.md'), source);
}

export function readGeneratedState(projectPath: string): GeneratedState {
  const path = generatedStatePath(projectPath);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GeneratedState;
  } catch {
    return {};
  }
}

export function writeGeneratedState(projectPath: string, patch: Partial<GeneratedState>): GeneratedState {
  const next = { ...readGeneratedState(projectPath), ...patch };
  writeFileSync(generatedStatePath(projectPath), JSON.stringify(next, null, 2));
  return next;
}
