import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { kubeversePath } from './paths.js';

export type AiProviderId = 'openrouter';

export interface StoredSettings {
  aiProvider: AiProviderId;
  model: string;
  apiKey?: string;
}

export interface PublicSettings {
  aiProvider: AiProviderId;
  model: string;
  hasApiKey: boolean;
}

const defaults: StoredSettings = { aiProvider: 'openrouter', model: 'openai/gpt-4o-mini' };

function settingsPath(): string {
  return kubeversePath('settings.json');
}

// Dev-mode local fallback storage: a plaintext file under ~/.kubeverse with
// owner-only permissions. Never committed to the project repo. Production
// desktop builds must move this to OS keychain storage (PLANNED).
export function readSettings(): StoredSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...defaults };
  try {
    return { ...defaults, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredSettings>) };
  } catch {
    return { ...defaults };
  }
}

export function writeSettings(patch: Partial<StoredSettings>): StoredSettings {
  const next = { ...readSettings(), ...patch };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}
