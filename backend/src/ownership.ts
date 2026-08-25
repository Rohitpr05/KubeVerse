// Centralized KubeVerse resource-ownership metadata. Every Kubernetes
// resource KubeVerse's generators produce (backend/src/generators/kubernetes.ts)
// carries these labels; the Playground's project-scoped observer queries
// (ClusterState.projectResources/projectSnapshot/projectGraph in
// cluster-state.ts) use these exact same constants to filter observed
// cluster state back down to a single project.
//
// This is the ONLY mechanism used to associate a real Kubernetes resource
// with a KubeVerse project - never namespace name, pod/deployment name,
// image name, or other string matching. A resource with no PROJECT_ID_LABEL
// is not KubeVerse's to claim and must never be inferred into any project's
// view (KUBEVERSE_MASTER_SPEC.md, section 3.2, "Real state over simulated
// state" - the Playground shows *observed* ownership, never a guess).
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'kubeverse';
export const PROJECT_ID_LABEL = 'kubeverse.dev/project-id';
export const PROJECT_NAME_LABEL = 'kubeverse.dev/project-name';

export interface ProjectContext {
  id: string;
  name: string;
}

// Kubernetes label values must match (([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?
// and be at most 63 characters. Project names are arbitrary user text (e.g.
// "TEST -001", which contains a space and so is not a legal label value on
// its own), so this sanitizes one into a safe value. It is used only for
// human-readable display (e.g. `kubectl get deploy -l kubeverse.dev/project-name=...`)
// - filtering always uses PROJECT_ID_LABEL, which is a UUIDv7 and already
// label-safe, because names are not guaranteed unique across projects the
// way project IDs are.
export function sanitizeLabelValue(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '');
  return cleaned.slice(0, 63) || 'project';
}

export function ownershipLabels(project: ProjectContext): Record<string, string> {
  return {
    [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
    [PROJECT_ID_LABEL]: project.id,
    [PROJECT_NAME_LABEL]: sanitizeLabelValue(project.name),
  };
}

export function isOwnedByProject(labels: Record<string, string> | undefined, projectId: string): boolean {
  return Boolean(labels && labels[PROJECT_ID_LABEL] === projectId);
}
