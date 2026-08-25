import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ArchitectureSpec } from '../architecture/schema.js';
import type { ProjectContext } from '../ownership.js';
import { generateDockerCompose } from './docker.js';
import { generateKubernetesManifests } from './kubernetes.js';
import { isManagedRuntime } from './managedService.js';
import { generateNodeService } from './nodeService.js';
import type { GeneratedFile } from './types.js';
import type { GeneratedFileRecord } from '../workspace.js';

// The AI describes the architecture; this function is the deterministic
// generator that actually produces the project (KUBEVERSE_MASTER_SPEC.md,
// "Code generator" - same spec in, same files out, every time). `project`
// identifies which KubeVerse project this generation belongs to, so the
// Kubernetes manifests can carry ownership labels (backend/src/ownership.ts)
// - Docker Compose output does not need them, since KubeVerse's project
// scoping only applies to the real Kubernetes observer/Playground.
export function planGeneratedFiles(spec: ArchitectureSpec, project: ProjectContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const service of spec.services) {
    if (!isManagedRuntime(service.runtime)) {
      for (const file of generateNodeService(service, spec)) files.push({ path: `generated/${file.path}`, contents: file.contents });
    }
  }
  files.push(generateDockerCompose(spec));
  files.push(...generateKubernetesManifests(spec, project));
  return files;
}

export function writeGeneratedFiles(projectPath: string, files: GeneratedFile[]): GeneratedFileRecord[] {
  return files.map((file) => {
    const absolutePath = join(projectPath, file.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.contents);
    return {
      path: file.path,
      bytes: Buffer.byteLength(file.contents),
      sha256: createHash('sha256').update(file.contents).digest('hex'),
    };
  });
}
