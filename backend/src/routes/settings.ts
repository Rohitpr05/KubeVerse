import type { FastifyInstance } from 'fastify';
import { readSettings, writeSettings, toPublicSettings, type AiProviderId } from '../local/settings.js';
import { getProvider } from '../architecture/providers/registry.js';

interface SettingsBody {
  aiProvider?: AiProviderId;
  model?: string;
  apiKey?: string;
}

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', async () => toPublicSettings(readSettings()));

  app.put('/api/settings', async (request, reply) => {
    const body = request.body as SettingsBody;
    if (body.aiProvider !== undefined && body.aiProvider !== 'openrouter') {
      return reply.code(400).send({ error: `Unsupported AI provider "${body.aiProvider}".` });
    }
    const patch: Partial<{ aiProvider: AiProviderId; model: string; apiKey: string }> = {};
    if (body.aiProvider !== undefined) patch.aiProvider = body.aiProvider;
    if (body.model !== undefined) patch.model = body.model;
    if (body.apiKey !== undefined && body.apiKey !== '') patch.apiKey = body.apiKey;
    return toPublicSettings(writeSettings(patch));
  });

  app.post('/api/settings/test-connection', async (request, reply) => {
    const settings = readSettings();
    if (!settings.apiKey) return reply.code(400).send({ valid: false, message: 'No API key is configured yet.' });
    const provider = getProvider(settings.aiProvider);
    const result = await provider.validateCredential(settings.apiKey);
    return result;
  });
}
