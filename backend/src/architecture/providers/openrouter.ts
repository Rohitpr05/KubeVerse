import { zodToJsonSchema } from 'zod-to-json-schema';
import { architectureSpecSchema } from '../schema.js';
import { toStrictJsonSchema } from './strictJsonSchema.js';
import type { AiProvider, CompileOptions, CredentialCheck } from './types.js';

const API_BASE = 'https://openrouter.ai/api/v1';

// $refStrategy 'none' inlines nested object schemas instead of $ref/definitions,
// which is safer for structured-output support that varies by model/provider.
// target: 'openAi' makes every optional/defaulted field nullable-and-required
// instead of omittable, which OpenAI/OpenRouter's strict structured-output
// mode requires of every object's `required` array (see schema.ts's
// `withDefault`/`optionalNullable`, which keep the Zod side of the same
// fields accepting the resulting `null` values). toStrictJsonSchema then
// fixes a second, separate strict-mode incompatibility zod-to-json-schema's
// "openAi" target does not handle - see strictJsonSchema.ts for exactly why.
// Exported so openrouter.test.ts can assert against the exact schema document
// sent to OpenRouter, not a reconstruction of it.
export const responseJsonSchema = toStrictJsonSchema(
  zodToJsonSchema(architectureSpecSchema, { name: 'architecture_spec', $refStrategy: 'none', target: 'openAi' }),
);

const SYSTEM_PROMPT = `You are KubeVerse's architecture compiler. Convert the user's plain-language application description into a single JSON object that matches the provided schema exactly.
Rules:
- Output ONLY the JSON object. No prose, no markdown code fences.
- Every service needs a lowercase kebab-case "name", a "type", a "runtime", and a "port".
- Use runtime "node" for any custom application service that needs generated source code.
- Use runtime "mongodb", "redis", "postgres", or "mysql" for managed data stores instead of "node" - these use a well-known image and do not get generated source code.
- Populate "dependsOn" with the names of services this service calls or connects to.
- Populate "traffic" with the request/data flow relationships the user described.
- Do not invent services the user did not describe or imply.
- Several fields (e.g. resources, healthCheck, replicas, protocol, command, volume) have sensible defaults. If you have no specific opinion, set them to null rather than guessing.`;

export const openRouterProvider: AiProvider = {
  id: 'openrouter',

  async compileArchitecture(source: string, options: CompileOptions): Promise<string> {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: source },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'architecture_spec', strict: true, schema: responseJsonSchema },
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter request failed: ${response.status} ${body.slice(0, 500)}`);
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter response did not include message content.');
    return content;
  },

  // GET /api/v1/key returns the calling key's validity and credit limits.
  async validateCredential(apiKey: string): Promise<CredentialCheck> {
    try {
      const response = await fetch(`${API_BASE}/key`, { headers: { authorization: `Bearer ${apiKey}` } });
      if (response.status === 401 || response.status === 403) return { valid: false, message: 'OpenRouter rejected this API key.' };
      if (!response.ok) return { valid: false, message: `OpenRouter returned HTTP ${response.status}.` };
      return { valid: true };
    } catch (error) {
      return { valid: false, message: error instanceof Error ? error.message : 'Network error contacting OpenRouter.' };
    }
  },
};
