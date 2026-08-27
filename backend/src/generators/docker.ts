import { stringify } from 'yaml';
import type { ArchitectureSpec } from '../architecture/schema.js';
import type { ProjectContext } from '../ownership.js';
import { allocateHostPorts } from './hostPort.js';
import { getProjectImageName } from './imageName.js';
import { managedImageFor } from './managedService.js';
import type { GeneratedFile } from './types.js';

// Writes one docker-compose.yml at docker/ covering every service in the spec,
// so `docker compose up` from that folder runs the whole generated architecture.
// `project` identifies which KubeVerse project this belongs to (same
// ProjectContext generators/kubernetes.ts already takes) - it is threaded
// through to getProjectImageName so a node-runtime service's build gets
// tagged with exactly the image name the Kubernetes manifests reference.
//
// The CONTAINER port published for each service is always exactly what the
// architecture spec declared (service.port, or the managed runtime's known
// port) - only the HOST side of the mapping is chosen dynamically, via a
// real OS-level "is this port free right now" check (see hostPort.ts) rather
// than reusing the container port number, which is what used to collide
// with KubeVerse's own backend (also port 4000 by default) whenever a
// generated service happened to use that same, common port number.
export async function generateDockerCompose(spec: ArchitectureSpec, project: ProjectContext): Promise<GeneratedFile> {
  const hostPorts = await allocateHostPorts(spec.services.length);
  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = {};

  spec.services.forEach((service, index) => {
    const hostPort = hostPorts[index];
    const managed = managedImageFor(service.runtime);
    const environment = Object.entries(service.env).map(([key, value]) => `${key}=${value}`);
    for (const dep of service.dependsOn) {
      const target = spec.services.find((candidate) => candidate.name === dep);
      // Service-to-service traffic goes over the compose network's own DNS
      // and the CONTAINER port - entirely unrelated to whichever host port
      // this container happens to be published on, so this stays untouched.
      if (target) environment.push(`${dep.replace(/-/g, '_').toUpperCase()}_URL=http://${dep}:${target.port}`);
    }

    if (managed) {
      const volumeName = `${service.name}-data`;
      for (const [key, value] of Object.entries(managed.env ?? {})) environment.push(`${key}=${value}`);
      services[service.name] = {
        image: managed.image,
        ports: [`${hostPort}:${managed.port}`],
        environment,
        volumes: managed.volumeMountPath ? [`${volumeName}:${managed.volumeMountPath}`] : undefined,
        networks: ['kubeverse'],
      };
      if (managed.volumeMountPath) volumes[volumeName] = {};
    } else {
      services[service.name] = {
        // Explicit `image:` so `docker compose build`/`up --build` tags the
        // built image with exactly the name Kubernetes will also reference -
        // without this, Compose invents its own tag from the compose
        // project's directory/name, which has no relation to what
        // generators/kubernetes.ts puts in the Deployment.
        image: getProjectImageName(project, service.name),
        build: { context: `../generated/${service.name}` },
        ports: [`${hostPort}:${service.port}`],
        environment: environment.length > 0 ? environment : undefined,
        depends_on: service.dependsOn.length > 0 ? service.dependsOn : undefined,
        networks: ['kubeverse'],
      };
    }
  });

  const compose = {
    name: spec.name,
    networks: { kubeverse: {} },
    services,
    volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
  };
  return { path: 'docker/docker-compose.yml', contents: stringify(compose) };
}
