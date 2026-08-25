import type { FastifyInstance } from 'fastify';
import { checkDockerAvailable } from '../execution/dockerRunner.js';
import { checkKubectlAvailable } from '../execution/kubernetesRunner.js';

// Real local-environment probes - never fabricated status. Docker/kubectl
// unavailability is reported plainly, not hidden behind a fake "ready" state.
export function registerEnvironmentRoutes(app: FastifyInstance): void {
  app.get('/api/environment', async () => {
    const [docker, kubernetes] = await Promise.all([checkDockerAvailable(), checkKubectlAvailable()]);
    return { docker, kubernetes, checkedAt: new Date().toISOString() };
  });
}
