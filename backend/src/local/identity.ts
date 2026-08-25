import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { kubeversePath } from './paths.js';
import { uuidv7 } from './uuidv7.js';

export interface Identity {
  installationId: string;
  createdAt: string;
}

function identityPath(): string {
  return kubeversePath('identity.json');
}

// Created once per local installation; this is the identifier KubeVerse shows
// in the UI, never the raw Firebase UID of an optional linked account.
export function getIdentity(): Identity {
  const path = identityPath();
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Identity;
    } catch {
      // fall through and regenerate a corrupt identity file
    }
  }
  const identity: Identity = { installationId: uuidv7(), createdAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}
