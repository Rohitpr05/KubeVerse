// Local project workspace: a project is a normal directory on disk, identified
// by a UUIDv7 stored in its own .kubeverse/metadata.json. KubeVerse never stores
// project content anywhere else; the ~/.kubeverse recent-projects index below
// holds only paths, as a convenience MRU list, not a source of truth.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kubeversePath } from './local/paths.js';
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
      name: name?.trim() || projectPath.split('/').filter(Boolean).pop() || 'project',
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
