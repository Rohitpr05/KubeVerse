import type { FastifyInstance } from 'fastify';
import { compileArchitecture } from '../architecture/compiler.js';
import { planGeneratedFiles, writeGeneratedFiles } from '../generators/write.js';
import { readSettings } from '../local/settings.js';
import { getProjectById, readGeneratedState, writeArchitectureSource, writeGeneratedState } from '../workspace.js';

interface CompileBody {
  projectId?: string;
  source?: string;
}

interface GenerateBody {
  projectId?: string;
}

export function registerArchitectureRoutes(app: FastifyInstance): void {
  app.post('/api/architecture/compile', async (request, reply) => {
    const body = request.body as CompileBody;
    if (!body.projectId) return reply.code(400).send({ error: 'projectId is required' });
    const project = getProjectById(body.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found. Open it first with POST /api/projects.' });

    const source = body.source ?? '';
    writeArchitectureSource(project.path, source);

    const settings = readSettings();
    if (!settings.apiKey) {
      return reply.code(400).send({ success: false, errors: ['No AI provider API key is configured. Add one in Settings.'] });
    }

    const outcome = await compileArchitecture(source, { providerId: settings.aiProvider, model: settings.model, apiKey: settings.apiKey });
    if (outcome.success) {
      writeGeneratedState(project.path, { lastCompiledAt: new Date().toISOString(), spec: outcome.spec });
    }
    return outcome;
  });

  app.post('/api/architecture/generate', async (request, reply) => {
    const body = request.body as GenerateBody;
    if (!body.projectId) return reply.code(400).send({ error: 'projectId is required' });
    const project = getProjectById(body.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found. Open it first with POST /api/projects.' });

    const state = readGeneratedState(project.path);
    if (!state.spec) {
      return reply.code(400).send({ error: 'No compiled architecture spec yet. Compile the architecture before generating a project.' });
    }

    const files = await planGeneratedFiles(state.spec, { id: project.id, name: project.name });
    const records = writeGeneratedFiles(project.path, files);
    const next = writeGeneratedState(project.path, { lastGeneratedAt: new Date().toISOString(), files: records });
    return { files: records, generatedState: next };
  });
}
