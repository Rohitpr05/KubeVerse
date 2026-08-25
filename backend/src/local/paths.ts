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
