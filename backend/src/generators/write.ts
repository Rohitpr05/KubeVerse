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
// identifies which KubeVerse project this generation belongs to: the
// Kubernetes manifests use it for ownership labels (backend/src/ownership.ts),
// and both the Kubernetes manifests and the Docker Compose file use it (via
// generators/imageName.ts) to derive the exact same local image name for
// each service, so Kubernetes never ends up referencing a different image
// than what Docker actually built.
export async function planGeneratedFiles(spec: ArchitectureSpec, project: ProjectContext): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const service of spec.services) {
    if (!isManagedRuntime(service.runtime)) {
      for (const file of generateNodeService(service, spec)) files.push({ path: `generated/${file.path}`, contents: file.contents });
    }
  }
  // Host-port allocation needs a real (async) OS-level availability check
  // (generators/hostPort.ts) - everything else here stays synchronous/pure.
  // Both generators take the same `project` so imageName.ts's
  // getProjectImageName produces one shared image name for both outputs.
  files.push(await generateDockerCompose(spec, project));
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
