import { stringify } from 'yaml';
import type { ArchitectureSpec } from '../architecture/schema.js';
import { managedImageFor } from './managedService.js';
import type { GeneratedFile } from './types.js';

// Writes one docker-compose.yml at docker/ covering every service in the spec,
// so `docker compose up` from that folder runs the whole generated architecture.
export function generateDockerCompose(spec: ArchitectureSpec): GeneratedFile {
  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = {};

  for (const service of spec.services) {
    const managed = managedImageFor(service.runtime);
    const environment = Object.entries(service.env).map(([key, value]) => `${key}=${value}`);
    for (const dep of service.dependsOn) {
      const target = spec.services.find((candidate) => candidate.name === dep);
      if (target) environment.push(`${dep.replace(/-/g, '_').toUpperCase()}_URL=http://${dep}:${target.port}`);
    }

    if (managed) {
      const volumeName = `${service.name}-data`;
      for (const [key, value] of Object.entries(managed.env ?? {})) environment.push(`${key}=${value}`);
      services[service.name] = {
        image: managed.image,
        ports: [`${service.port}:${managed.port}`],
        environment,
        volumes: managed.volumeMountPath ? [`${volumeName}:${managed.volumeMountPath}`] : undefined,
        networks: ['kubeverse'],
      };
      if (managed.volumeMountPath) volumes[volumeName] = {};
    } else {
      services[service.name] = {
        build: { context: `../generated/${service.name}` },
        ports: [`${service.port}:${service.port}`],
        environment: environment.length > 0 ? environment : undefined,
        depends_on: service.dependsOn.length > 0 ? service.dependsOn : undefined,
        networks: ['kubeverse'],
      };
    }
  }

  const compose = {
    name: spec.name,
    networks: { kubeverse: {} },
    services,
    volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
  };
  return { path: 'docker/docker-compose.yml', contents: stringify(compose) };
}
