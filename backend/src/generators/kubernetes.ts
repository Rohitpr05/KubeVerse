import { stringify } from 'yaml';
import type { ArchitectureSpec, ServiceSpec } from '../architecture/schema.js';
import { ownershipLabels, type ProjectContext } from '../ownership.js';
import { getProjectImageName } from './imageName.js';
import { managedImageFor } from './managedService.js';
import type { GeneratedFile } from './types.js';

// spec.name is arbitrary free text (the AI-compiled architecture's own
// name, e.g. "Application Server Architecture") - not safe to use directly
// as a Kubernetes object name, which must match RFC 1123 (lowercase
// alphanumeric and '-', starting/ending alphanumeric).
function sanitizeResourceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function namespaceName(spec: ArchitectureSpec): string {
  return `kubeverse-${sanitizeResourceName(spec.name)}`;
}

// Deterministically derives Namespace/Deployment/Service/ConfigMap/Secret/PVC/
// Ingress manifests from the validated NAM - never from raw AI output - reusing
// the probe/label conventions already used by examples/legacy-simulator/k8s.
//
// Every generated resource carries the KubeVerse ownership labels
// (backend/src/ownership.ts) so the observer's project-scoped Playground
// queries can reliably tell which real cluster resources belong to this
// project. Deployments additionally carry them on the Pod template
// (spec.template.metadata.labels), not just the Deployment's own metadata -
// Kubernetes propagates pod-template labels onto the ReplicaSet and Pods it
// creates, so those inherit ownership automatically without KubeVerse ever
// touching a ReplicaSet/Pod object directly.
export function generateKubernetesManifests(spec: ArchitectureSpec, project: ProjectContext): GeneratedFile[] {
  const ns = namespaceName(spec);
  const ownership = ownershipLabels(project);
  const files: GeneratedFile[] = [
    {
      path: 'kubernetes/namespace.yaml',
      contents: stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns, labels: { ...ownership } } }),
    },
  ];

  const exposedHttpServices: ServiceSpec[] = [];

  for (const service of spec.services) {
    const managed = managedImageFor(service.runtime);
    // Managed runtimes (mongodb/redis/postgres/mysql) reference a real,
    // public image and are genuinely meant to be pulled from a registry.
    // Everything else is a KubeVerse-generated service - its image must be
    // exactly what generators/docker.ts builds and tags locally (see
    // imageName.ts for why), never invented separately here.
    const image = managed ? managed.image : getProjectImageName(project, service.name);
    const containerPort = managed ? managed.port : service.port;

    const dependsEnv = service.dependsOn.map((dep) => {
      const target = spec.services.find((candidate) => candidate.name === dep);
      return { name: `${dep.replace(/-/g, '_').toUpperCase()}_URL`, value: `http://${dep}.${ns}.svc.cluster.local:${target?.port ?? 80}` };
    });

    const hasConfigEnv = Object.keys(service.env).length > 0;
    const hasSecretEnv = Boolean(managed?.env && Object.keys(managed.env).length > 0);
    const envFrom = [
      hasConfigEnv ? { configMapRef: { name: `${service.name}-config` } } : undefined,
      hasSecretEnv ? { secretRef: { name: `${service.name}-secret` } } : undefined,
    ].filter(Boolean);

    const volumeName = `${service.name}-data`;
    const usesVolume = Boolean(managed?.volumeMountPath);

    const container: Record<string, unknown> = {
      name: service.name,
      image,
      // Locally-built services are always tagged ":latest" (see
      // imageName.ts), and Kubernetes' own default imagePullPolicy for a
      // ":latest" tag is "Always" - meaning it would try a registry pull on
      // every pod creation regardless of a same-named image already sitting
      // in the local Docker Desktop Kubernetes image store. "IfNotPresent"
      // is deliberately used instead of "Never": if the local build was
      // somehow skipped or failed, this still falls back to attempting a
      // pull (which fails with a clear, diagnosable "not found" instead of
      // the less helpful ErrImageNeverPull), rather than the happy path
      // needlessly reaching the network for an image that's already built.
      // Managed-runtime images (mongo:7, redis:7-alpine, ...) are real,
      // versioned public images and are left on Kubernetes' normal default.
      imagePullPolicy: managed ? undefined : 'IfNotPresent',
      ports: [{ containerPort }],
      envFrom: envFrom.length > 0 ? envFrom : undefined,
      env: dependsEnv.length > 0 ? dependsEnv : undefined,
      resources: { requests: service.resources.requests, limits: service.resources.limits },
      volumeMounts: usesVolume ? [{ name: volumeName, mountPath: managed!.volumeMountPath }] : undefined,
    };
    if (service.protocol === 'http') {
      const probe = { httpGet: { path: service.healthCheck.path, port: containerPort }, periodSeconds: service.healthCheck.intervalSeconds, timeoutSeconds: service.healthCheck.timeoutSeconds };
      container.readinessProbe = probe;
      container.livenessProbe = probe;
    }

    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: service.name, namespace: ns, labels: { app: service.name, ...ownership } },
      spec: {
        replicas: service.replicas,
        // The selector stays scoped to just this service (unique within the
        // project's namespace, validated by the NAM's duplicate-name check) -
        // only the pod *template* additionally carries the project-wide
        // ownership labels, since Kubernetes requires every selector key to
        // also appear on the template, but not the other way around.
        selector: { matchLabels: { app: service.name } },
        template: {
          metadata: { labels: { app: service.name, ...ownership } },
          spec: {
            containers: [container],
            volumes: usesVolume ? [{ name: volumeName, persistentVolumeClaim: { claimName: volumeName } }] : undefined,
          },
        },
      },
    };

    const service_ = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: service.name, namespace: ns, labels: { app: service.name, ...ownership } },
      spec: { selector: { app: service.name }, ports: [{ port: containerPort, targetPort: containerPort }], type: service.expose ? 'LoadBalancer' : 'ClusterIP' },
    };

    files.push({ path: `kubernetes/${service.name}/deployment.yaml`, contents: stringify(deployment) });
    files.push({ path: `kubernetes/${service.name}/service.yaml`, contents: stringify(service_) });

    if (hasConfigEnv) {
      files.push({
        path: `kubernetes/${service.name}/configmap.yaml`,
        contents: stringify({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: `${service.name}-config`, namespace: ns, labels: { app: service.name, ...ownership } }, data: service.env }),
      });
    }
    if (hasSecretEnv) {
      files.push({
        path: `kubernetes/${service.name}/secret.yaml`,
        contents: stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: `${service.name}-secret`, namespace: ns, labels: { app: service.name, ...ownership } }, stringData: managed!.env }),
      });
    }
    if (usesVolume) {
      files.push({
        path: `kubernetes/${service.name}/pvc.yaml`,
        contents: stringify({
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: { name: volumeName, namespace: ns, labels: { app: service.name, ...ownership } },
          spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } },
        }),
      });
    }

    if (service.expose && service.protocol === 'http') exposedHttpServices.push(service);
  }

  if (exposedHttpServices.length > 0) {
    const ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: `${sanitizeResourceName(spec.name)}-ingress`, namespace: ns, labels: { ...ownership } },
      spec: {
        rules: [
          {
            http: {
              paths: exposedHttpServices.map((service) => ({
                path: `/${service.name}`,
                pathType: 'Prefix',
                backend: { service: { name: service.name, port: { number: managedImageFor(service.runtime)?.port ?? service.port } } },
              })),
            },
          },
        ],
      },
    };
    files.push({ path: 'kubernetes/ingress.yaml', contents: stringify(ingress) });
  }

  return files;
}
