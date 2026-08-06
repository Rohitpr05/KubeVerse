import { hostname } from 'node:os';

// Environment-driven configuration mirrors how the same image will later run in Kubernetes.
export function createConfig(defaults) {
  const port = Number(process.env.PORT ?? defaults.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  return {
    serviceName: process.env.SERVICE_NAME ?? defaults.serviceName,
    port,
    instanceId: process.env.INSTANCE_ID ?? `${defaults.serviceName}-${hostname()}`,
    eventLimit: Number(process.env.EVENT_LIMIT ?? 500),
    mongoUrl: process.env.MONGO_URL ?? 'mongodb://mongodb:27017/simulator',
    redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
    ...defaults.extra
  };
}
