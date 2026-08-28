import { validateArchitectureSpec, type ArchitectureSpec } from './schema.js';
import { getProvider } from './providers/registry.js';
import { normalizeModel } from '../local/settings.js';
import type { AiProvider } from './providers/types.js';

export interface CompileSuccess {
  success: true;
  spec: ArchitectureSpec;
  raw: string;
}

export interface CompileFailure {
  success: false;
  errors: string[];
  raw?: string;
}

export type CompileOutcome = CompileSuccess | CompileFailure;

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export interface CompileRequest {
  providerId: string;
  model: string;
  apiKey: string;
}

// The AI proposal is never trusted directly: it must parse as JSON and pass
// architectureSpecSchema before KubeVerse treats it as a valid architecture.
// `provider` is injectable so this pipeline is testable without a live key.
export async function compileArchitecture(
  source: string,
  request: CompileRequest,
  provider: AiProvider = getProvider(request.providerId),
): Promise<CompileOutcome> {
  if (!source.trim()) return { success: false, errors: ['Architecture description is empty.'] };
  if (!request.apiKey) return { success: false, errors: ['No AI provider API key is configured. Add one in Settings.'] };

  // Final safety net before the provider request is built (§ "the backend is
  // the final safety net"): resolves an empty/missing model to
  // DEFAULT_OPENROUTER_MODEL regardless of whether readSettings() already
  // did the same - this function's own contract must hold for any caller,
  // not just today's one route that happens to go through readSettings()
  // first. This is what fixes the real reported bug at its root: OpenRouter
  // rejecting a request with `"model": ""` ("No models provided") can no
  // longer happen from this function, independent of what state
  // ~/.kubeverse/settings.json happens to be in.
  const model = normalizeModel(request.model);

  let raw: string;
  try {
    raw = await provider.compileArchitecture(source, { model, apiKey: request.apiKey });
  } catch (error) {
    return { success: false, errors: [error instanceof Error ? error.message : 'AI provider request failed.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { success: false, errors: ['The AI provider did not return valid JSON.'], raw };
  }

  const result = validateArchitectureSpec(parsed);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      raw,
    };
  }
  return { success: true, spec: result.data, raw };
}
