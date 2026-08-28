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
  // The real, currently-shipped fallback model (see DEFAULT_OPENROUTER_MODEL
  // below) - exposed so Settings can show the user what "no custom model"
  // actually resolves to, instead of a static placeholder string that looks
  // like a real value but isn't one (see this constant's own comment for
  // exactly how that ambiguity became a real bug).
  defaultModel: string;
}

// The one source of truth for "what model does KubeVerse use when the user
// hasn't chosen one" - read by local/settings.ts (defaults + self-healing),
// routes/settings.ts (never persisting a blank model), and
// architecture/compiler.ts (the final resolution before the OpenRouter
// request is built). Never duplicated as a second hardcoded string anywhere
// in this codebase.
//
// Verified live against OpenRouter's real /api/v1/models endpoint on
// 2026-08-28, not guessed: a real architecture.md was actually compiled
// through this exact pipeline (compileArchitecture -> openRouterProvider ->
// strict json_schema response_format -> architectureSpecSchema validation)
// against several current ":free" OpenRouter models. Several genuinely
// available, metadata-labeled "response_format"-capable free models still
// failed in practice - z-ai/glm-5.2:free and google/gemma-4-31b-it:free were
// both rate-limited (HTTP 429, "temporarily rate-limited upstream");
// nvidia/nemotron-3-super-120b-a12b:free took over two minutes and returned
// no content; minimax/minimax-m2.7:free responded quickly but did not
// actually honor the strict schema (invented enum values, omitted the
// required "name" field). dots-studio/dots-3-note-preview:free was the one
// candidate that produced a fully schema-valid, correctly-structured result
// on two separate real runs, genuinely free (pricing: prompt "0"/completion
// "0"). OpenRouter's free-tier model lineup rotates over time - this is a
// verified-working choice as of this date, not a permanent guarantee; a user
// can always override it in Settings.
export const DEFAULT_OPENROUTER_MODEL = 'dots-studio/dots-3-note-preview:free';

const defaults: StoredSettings = { aiProvider: 'openrouter', model: DEFAULT_OPENROUTER_MODEL };

function settingsPath(): string {
  return kubeversePath('settings.json');
}

// A blank/whitespace-only model is never treated as a real custom choice -
// it collapses to the real default on every read. This is what actually
// closes the "No models provided" bug: previously, a stored `model: ""`
// (written once, e.g. by Settings' Save button firing before its own GET
// /api/settings fetch had resolved the real value - a genuine race, not a
// contrived edge case) would silently win over `defaults.model` in
// `{...defaults, ...parsed}` forever, since the key was *present*, just
// empty - every later read, and therefore every AI Builder compile request,
// sent an empty "model" field to OpenRouter, which correctly rejects that
// with "No models provided". Self-heals on every read - no migration step,
// no need for a user to delete or hand-edit settings.json.
// Exported (not just used internally) so architecture/compiler.ts can apply
// the exact same rule as its own last-line defense before an OpenRouter
// request is actually built - "the backend is the final safety net" means
// more than one layer, not just this file's own read/write path being
// correct. A future second caller of compileArchitecture() that doesn't go
// through readSettings() at all (not a hypothetical this codebase currently
// has, but a real contract worth guaranteeing) still can never produce a
// blank "model" field.
export function normalizeModel(model: unknown): string {
  return typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_OPENROUTER_MODEL;
}

// Dev-mode local fallback storage: a plaintext file under ~/.kubeverse with
// owner-only permissions. Never committed to the project repo. Production
// desktop builds must move this to OS keychain storage (PLANNED).
export function readSettings(): StoredSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...defaults };
  try {
    const merged = { ...defaults, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredSettings>) };
    return { ...merged, model: normalizeModel(merged.model) };
  } catch {
    return { ...defaults };
  }
}

// Normalizes `model` here too, not just in readSettings() - a second,
// independent guard (not a stricter one; the same rule) so a blank model can
// never actually reach disk in the first place, regardless of what any
// current or future caller passes as `patch.model`.
export function writeSettings(patch: Partial<StoredSettings>): StoredSettings {
  const current = readSettings();
  const next = { ...current, ...patch, model: normalizeModel(patch.model ?? current.model) };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey), defaultModel: DEFAULT_OPENROUTER_MODEL };
}
