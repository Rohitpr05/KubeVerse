import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { checkDockerAvailable, composeDown, composeUp } from '../execution/dockerRunner.js';
import { checkKubectlAvailable, applyManifests } from '../execution/kubernetesRunner.js';
import { getProjectById, writeGeneratedState } from '../workspace.js';

interface ProjectParams {
  id: string;
}

// Thin routes over the existing execution abstractions (backend/src/execution/):
// fixed, parameterized commands scoped to the selected project's own generated
// output - never arbitrary shell input from the browser.
export function registerExecutionRoutes(app: FastifyInstance): void {
  app.post('/api/projects/:id/docker/up', async (request, reply) => {
    const { id } = request.params as ProjectParams;
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    const dockerDir = join(project.path, 'docker');
    if (!existsSync(join(dockerDir, 'docker-compose.yml'))) {
      return reply.code(400).send({ error: 'No generated docker-compose.yml yet. Generate the project first.' });
    }
    const availability = await checkDockerAvailable();
    if (!availability.available) return reply.code(503).send({ error: `Docker is not available: ${availability.error ?? 'unknown error'}` });

    return composeUp(dockerDir);
  });

  app.post('/api/projects/:id/docker/down', async (request, reply) => {
    const { id } = request.params as ProjectParams;
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    const dockerDir = join(project.path, 'docker');
    if (!existsSync(join(dockerDir, 'docker-compose.yml'))) {
      return reply.code(400).send({ error: 'No generated docker-compose.yml yet. Generate the project first.' });
    }
    return composeDown(dockerDir);
  });

  app.post('/api/projects/:id/kubernetes/apply', async (request, reply) => {
    const { id } = request.params as ProjectParams;
    const project = getProjectById(id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    const kubernetesDir = join(project.path, 'kubernetes');
    if (!existsSync(join(kubernetesDir, 'namespace.yaml'))) {
      return reply.code(400).send({ error: 'No generated Kubernetes manifests yet. Generate the project first.' });
    }
    const availability = await checkKubectlAvailable();
    if (!availability.available) return reply.code(503).send({ error: `kubectl is not available: ${availability.error ?? 'unknown error'}` });

    const result = await applyManifests(kubernetesDir);
    if (result.ok) writeGeneratedState(project.path, { lastDeployedAt: new Date().toISOString() });
    return result;
  });
}
