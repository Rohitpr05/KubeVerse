import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getProjectById, listProjectsWithArchitecture, openOrCreateProject, readArchitectureSource, readGeneratedState } from '../workspace.js';

interface OpenProjectBody {
  path?: string;
  name?: string;
}

function resolveProjectOr404(id: string, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  const project = getProjectById(id);
  if (!project) {
    reply.code(404).send({ error: 'Project not found. Open it first with POST /api/projects.' });
    return undefined;
  }
  return project;
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', async () => ({ projects: listProjectsWithArchitecture() }));

  app.post('/api/projects', async (request, reply) => {
    const body = request.body as OpenProjectBody;
    if (!body.path || !body.path.trim()) return reply.code(400).send({ error: 'path is required' });
    try {
      return openOrCreateProject(body.path, body.name);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to open project directory.' });
    }
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = resolveProjectOr404(id, reply);
    if (!project) return;
    return {
      ...project,
      architecture: readArchitectureSource(project.path),
      generatedState: readGeneratedState(project.path),
    };
  });

  // Path-traversal-guarded read-only preview of a generated file.
  app.get('/api/projects/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path: relativePath } = request.query as { path?: string };
    const project = resolveProjectOr404(id, reply);
    if (!project) return;
    if (!relativePath) return reply.code(400).send({ error: 'path query parameter is required' });

    const absolutePath = resolve(project.path, relativePath);
    const withinProject = relative(project.path, absolutePath);
    if (withinProject.startsWith('..') || resolve(project.path, withinProject) !== absolutePath) {
      return reply.code(400).send({ error: 'path escapes the project directory' });
    }
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return reply.code(404).send({ error: 'File not found' });
    }
    return { path: relativePath, contents: readFileSync(absolutePath, 'utf8') };
  });
}
