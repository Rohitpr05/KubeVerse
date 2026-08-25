import type { FastifyInstance } from 'fastify';
import { getIdentity } from '../local/identity.js';

export function registerIdentityRoutes(app: FastifyInstance): void {
  app.get('/api/identity', async () => getIdentity());
}
