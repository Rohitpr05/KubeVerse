import type { ProjectContext } from '../ownership.js';

// Docker/OCI repository names must be lowercase and match
// [a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*. This produces a project-name-derived
// slug that fits that grammar; unlike ownership.ts's sanitizeLabelValue it
// must lowercase (Kubernetes label values are case-sensitive and allowed to
// have uppercase - Docker repository names are not).
function sanitizeImageComponent(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '');
  return cleaned.slice(0, 40) || 'project';
}

// The single source of truth for what a generated service's local Docker
// image is called - used identically by generators/docker.ts (what gets
// built and tagged) and generators/kubernetes.ts (what the Deployment
// references), so the two can never invent two different names for the same
// service (the root cause behind pods failing with "pull access denied /
// repository does not exist": kubernetes.ts used to build
// `${spec.name}/${service.name}:latest` straight from the AI-compiled
// architecture's free-text name - e.g. "Application Server Architecture" -
// while docker.ts let Docker Compose invent its own, different tag from
// scratch. A slash-separated name is also unsafe on its own terms: Docker
// treats anything before the first "/" as a registry namespace unless it
// contains a "." or ":" or is literally "localhost", so a free-text
// architecture name there gets read as "pull this from docker.io/<name>"
// instead of "this is a local image".
//
// Anchored on project.id (a UUIDv7, already globally unique and already
// label-safe - see ownership.ts) rather than the architecture's spec.name,
// which has no uniqueness guarantee across different KubeVerse projects
// (two projects can compile architectures that both end up named "shop")
// and is exactly the free-text value that caused the bug. service.name is
// used as-is: the Normalized Architecture Model already requires it to
// match ^[a-z][a-z0-9-]*$ (architecture/schema.ts), which is already a
// valid Docker repository component.
export function getProjectImageName(project: ProjectContext, serviceName: string): string {
  const projectSlug = sanitizeImageComponent(project.name);
  // Taken from the END of the id, not the start: a UUIDv7's first 48 bits
  // are a millisecond timestamp (RFC 9562), so two projects created close
  // together share a long common prefix - truncating from the front would
  // reintroduce exactly the collision this helper exists to prevent. The
  // trailing hex characters fall within the UUID's random bits instead.
  const shortId = project.id.replace(/-/g, '').slice(-8);
  return `kubeverse-${projectSlug}-${shortId}-${serviceName}:latest`;
}
