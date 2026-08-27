import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { checkDockerAvailable, composeBuild, composeDown, composeUp } from '../execution/dockerRunner.js';
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
    const dockerDir = join(project.path, 'docker');
    if (!existsSync(join(kubernetesDir, 'namespace.yaml'))) {
      return reply.code(400).send({ error: 'No generated Kubernetes manifests yet. Generate the project first.' });
    }
    const availability = await checkKubectlAvailable();
    if (!availability.available) return reply.code(503).send({ error: `kubectl is not available: ${availability.error ?? 'unknown error'}` });

    // BUILD BEFORE APPLY: the generated Deployments reference local images
    // (generators/imageName.ts) that only exist once Docker has actually
    // built them. Reuses the exact same docker-compose.yml Docker Compose
    // already builds from (composeBuild = `docker compose build`, no `up`),
    // so this never invents a second, different build path - it just makes
    // sure that path has run before kubectl gets a chance to create a Pod
    // that would otherwise go straight to ImagePullBackOff.
    if (existsSync(join(dockerDir, 'docker-compose.yml'))) {
      const dockerAvailability = await checkDockerAvailable();
      if (!dockerAvailability.available) {
        return reply.code(503).send({ error: `Docker is not available: ${dockerAvailability.error ?? 'unknown error'}. Could not build local images, so Kubernetes deployment was not started.` });
      }
      const build = await composeBuild(dockerDir);
      if (!build.ok) {
        return reply.code(502).send({ error: 'Could not build local images. Kubernetes deployment was not started.', output: build.output });
      }
    }

    const result = await applyManifests(kubernetesDir);
    if (result.ok) writeGeneratedState(project.path, { lastDeployedAt: new Date().toISOString() });
    return result;
  });
}
