// Dev-mode local config directory for identity, settings, and the recent-projects
// index. This is a documented fallback, not the production design: a packaged
// desktop build should use OS-idiomatic app-data paths and OS keychain storage
// (see KUBEVERSE_MASTER_SPEC.md, "Local identity and credentials").
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env.KUBEVERSE_HOME ?? join(homedir(), '.kubeverse');

export function kubeverseHome(): string {
  mkdirSync(root, { recursive: true });
  return root;
}

export function kubeversePath(...segments: string[]): string {
  return join(kubeverseHome(), ...segments);
}

// Where KubeVerse *user projects* live - deliberately separate from
// kubeverseHome() above, which is hidden application config/state
// (~/.kubeverse: identity, settings, the recent-projects index). Project
// directories are the user's own data - architecture.md, generated source,
// Docker/Kubernetes output - and must survive a KubeVerse reinstall/update,
// so they get a normal, visible, discoverable folder rather than living
// under a dotfile directory or (worse) inside KubeVerse's own source tree
// (KUBEVERSE_MASTER_SPEC.md, "Local project workspace").
const projectsRootPath = process.env.KUBEVERSE_PROJECTS_HOME ?? join(homedir(), 'KubeVerse');

export function projectsRoot(): string {
  mkdirSync(projectsRootPath, { recursive: true });
  return projectsRootPath;
}
