// Short, static explanations for common Kubernetes kinds - the foundation
// for a future walkthrough/tutorial mode, kept intentionally minimal here:
// one collapsed sentence per kind, not a textbook.
const EXPLANATIONS: Record<string, string> = {
  Namespace: 'A virtual cluster within a Kubernetes cluster, used to group and isolate related resources.',
  Node: 'A physical or virtual machine that runs Pods. The scheduler places Pods on Nodes with enough available resources.',
  Deployment: 'Defines the desired state for a set of Pods and manages ReplicaSets to keep that state running, including rolling updates.',
  ReplicaSet: "Ensures a specified number of identical Pod replicas are running at all times. Usually managed by a Deployment, not created directly.",
  DaemonSet: 'Ensures a copy of a Pod runs on every (or every matching) Node in the cluster.',
  StatefulSet: 'Manages Pods that need a stable identity and stable storage, such as databases.',
  Pod: 'The smallest deployable unit in Kubernetes. A Pod contains one or more containers that share network and storage.',
  Container: 'A single running process packaged with its dependencies, running inside a Pod.',
  Service: 'Provides a stable network endpoint for a set of Pods, so other workloads can reach them without tracking individual Pod IPs.',
  Ingress: 'Routes external HTTP(S) traffic to Services inside the cluster, based on hostnames and paths.',
  Job: 'Runs one or more Pods to completion for a finite task, retrying on failure.',
  CronJob: 'Runs a Job on a repeating schedule, like a cron entry for the cluster.',
  ConfigMap: 'Stores non-sensitive configuration data as key-value pairs, which Pods can consume as environment variables or files.',
  Secret: 'Stores sensitive data (credentials, tokens) similarly to a ConfigMap, intended for more restricted access.',
  PersistentVolume: 'A piece of storage provisioned in the cluster, independent of any single Pod’s lifecycle.',
  PersistentVolumeClaim: 'A request for storage by a user, which binds to a matching PersistentVolume.',
  StorageClass: 'Describes a class of storage (e.g. speed, backend) that PersistentVolumes can be dynamically provisioned from.',
};

export function ConceptHint({ kind }: { kind: string }) {
  const explanation = EXPLANATIONS[kind];
  if (!explanation) return null;
  return (
    <details className="concept-hint">
      <summary>What is this?</summary>
      <p>{explanation}</p>
    </details>
  );
}
