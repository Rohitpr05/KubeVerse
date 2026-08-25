import { stringify } from 'yaml';
import type { ArchitectureSpec, ServiceSpec } from '../architecture/schema.js';
import { ownershipLabels, type ProjectContext } from '../ownership.js';
import { managedImageFor } from './managedService.js';
import type { GeneratedFile } from './types.js';

function namespaceName(spec: ArchitectureSpec): string {
  return `kubeverse-${spec.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
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
    const image = managed ? managed.image : `${spec.name}/${service.name}:latest`;
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
      metadata: { name: `${spec.name}-ingress`, namespace: ns, labels: { ...ownership } },
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
