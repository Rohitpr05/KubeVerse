# Interactive Kubernetes Learning Platform Architecture

## Decision summary

The existing microservices remain the **workloads being taught**. A new
visualization platform observes a real Kubernetes cluster and presents that
state to the learner. It does not invent cluster objects or treat animation as
the source of truth.

The first functional slice will be a read-only Cluster Explorer for the
`k8s-simulator` namespace: it lists and watches Deployments, ReplicaSets, Pods,
and Services, then renders their real relationships in a browser. Later phases
add controlled, explicitly local actions such as traffic generation and Pod
deletion.

## Target repository shape

```text
backend/       Kubernetes observer, state projection, API, and safe action API.
frontend/      Learner-facing React application and learning panel.
simulator/     Traffic and failure scenario definitions; no Kubernetes client UI code.
visualizer/    Kubernetes snapshot-to-graph projection and reusable visual components.
k8s/           The learning workloads, platform RBAC, and later platform deployment assets.
services/      Existing simulated Gateway, Validation, Security, and OCR workloads.
shared/        Existing shared service runtime; stays separate from platform contracts.
docs/          Architecture, curriculum, scenarios, and operator guides.
```

`backend`, `frontend`, `simulator`, and `visualizer` should be added gradually
instead of as one large scaffold. The visualization types must not import the
Kubernetes client directly: a backend projection translates Kubernetes objects
into a stable, UI-oriented contract.

## Core architecture

```text
Kubernetes API ── list/watch ──> Observer ──> state cache/projector
                                          │              │
                                          │              ├── REST snapshots
                                          │              └── SSE transition stream
                                          │
Frontend <────────────────────────────────┘
   │  cluster map · timeline · inspector · learning panel
   │
   └── explicit action request ──> Action API ──> Kubernetes API / traffic runner
```

### Source-of-truth rules

1. Kubernetes API list/watch responses are authoritative for object state.
2. Kubernetes Events enrich the timeline but are best-effort and short-lived;
   they must never be the sole state source.
3. Metrics come from `metrics.k8s.io` when available and are shown as sampled,
   not as a guaranteed event stream.
4. A visualization transition exists only when the projector observes a real
   resource change (for example, a Pod phase or readiness condition changes).
   The frontend may interpolate that observed change visually, but never invent
   a Pod, scale event, or recovery outcome.
5. Learner-initiated actions are recorded as separate `learner_action` timeline
   entries. The subsequent Kubernetes response is still observed independently.

This distinction matters because Kubernetes explicitly describes Events as
informative, best-effort data with limited retention. [Kubernetes Events API](https://kubernetes.io/docs/reference/kubernetes-api/events/)

## Platform components

| Component | Responsibility | Reusable boundary |
| --- | --- | --- |
| Kubernetes observer | Initial list, resilient watches, reconnect, and resource-version handling. | Produces normalized resource changes. |
| State cache | Current namespace-scoped object graph, keyed by UID. | Read model for APIs and tests. |
| Projector | Converts Kubernetes resources into UI snapshots, transitions, graph nodes, and edges. | No HTTP or Kubernetes client dependency. |
| Timeline builder | Merges observed changes, Kubernetes Events, and learner actions chronologically. | Explains provenance for every entry. |
| Read API | Serves a current snapshot, object detail, YAML, and learning metadata. | REST first. |
| Live stream | Publishes ordered snapshot deltas and timeline entries. | Server-Sent Events initially. |
| Action API | Validates an allowlisted local learning action and invokes the cluster/traffic runner. | Disabled or read-only by default. |
| Scenario engine | Defines repeatable traffic and failure exercises. | Isolated from visualization and API client details. |
| Visualizer | Renders the projected graph, timeline, metrics, and object state. | Consumes platform contracts only. |
| Learning catalog | Concepts, prerequisites, explanations, YAML excerpts, pitfalls, and unlock state. | Content data, not JSX conditionals. |

## Recommended technology choices

| Area | Choice | Why |
| --- | --- | --- |
| Observer/API | Node.js 22 + TypeScript + Fastify + `@kubernetes/client-node` | Matches the existing runtime while adding typed contracts and a small HTTP surface. |
| Live updates | Server-Sent Events in early phases | The first UI needs ordered server-to-browser state updates, reconnection, and no bidirectional protocol. REST handles actions. WebSocket remains an option only when a concrete bidirectional need appears. |
| Frontend | React + TypeScript + Vite | Vite provides a current React/TypeScript template and a fast local workflow. [Vite guide](https://vite.dev/guide/) |
| Topology canvas | `@xyflow/react` (React Flow) | Custom React nodes, selection, pan/zoom, minimap, and edges fit a clickable Kubernetes object graph. [React Flow documentation](https://reactflow.dev/) |
| Charts | Small SVG/CSS charts initially; add a chart library only with real metric histories | Keeps the first slice lightweight and inspectable. |
| Contract validation | TypeScript types plus runtime schema validation at the HTTP boundary | Prevents browser state from becoming an accidental Kubernetes API mirror. |
| Tests | Node unit tests for projector/scenario logic; browser component tests; a local-cluster smoke test later | Separates deterministic visual logic from cluster-dependent behavior. |

React Flow is appropriate for the topology canvas because its nodes are React
components and can be custom-rendered with object state and controls. [React
Flow node model](https://reactflow.dev/api-reference/types/node)

## Kubernetes integration model

### Development mode

The platform backend runs on the developer machine and uses the selected
`KUBECONFIG` context. It is strictly namespace-scoped at first. A startup screen
shows the selected context and namespace, never silently choosing a cluster.

### In-cluster mode

Later, the backend can run as a Kubernetes Deployment using a dedicated Service
Account. RBAC starts read-only and namespace-scoped. Mutating permissions are
added only for specific, documented learning actions.

### Watch strategy

For each required resource kind, the observer performs:

1. Initial list and cache population.
2. Watch from the returned resource version.
3. Cache/projector update for `ADDED`, `MODIFIED`, `DELETED`, and `BOOKMARK`.
4. Relist and reconnect on expiration, disconnect, or invalid resource version.

The user interface receives snapshots/deltas from this cache, not a browser
connection directly to the Kubernetes API. This permits reconnection, testing,
filtering, action audit entries, and a stable pedagogical data model.

## UI model

The first screen has four persistent regions:

```text
Module rail | Cluster topology canvas | Inspector / learning panel
            | Timeline + traffic/action controls
```

- **Topology canvas:** Namespace → Deployment → ReplicaSet → Pod → Container;
  Service selector edges are a distinct style from ownership edges.
- **Inspector:** object identity, observed status, current YAML, lifecycle,
  explanation, best practices, and common mistakes.
- **Timeline:** all entries include a source (`observed_change`,
  `kubernetes_event`, or `learner_action`) and timestamp.
- **Learning rail:** modules unlock through completed exercises. Early unlock
  state is browser-local; it should not block viewing real cluster state.

The graph uses Kubernetes UID as its stable identifier and resource references
for edges. Names are display labels only, because names can be reused after an
object is recreated.

## Controlled actions and safety model

The Action API is not a general `kubectl` proxy. It accepts a narrow action
schema such as `delete_pod`, `scale_deployment`, `restart_deployment`, and a
traffic scenario start/stop. Every action must include the selected namespace,
target UID, scenario ID when applicable, and an explicit confirmation token.

Guardrails:

- Only the configured learning namespace is mutable.
- Objects must have a platform/learning label before they are eligible.
- Actions are allowlisted; arbitrary shell execution is never exposed.
- The API returns an acknowledgement, not a claimed outcome.
- The timeline labels the request as a learner action and waits for actual
  Kubernetes state transitions to explain recovery.
- Destructive actions require a confirmation step and a visible reset path.

## Curriculum mapping

| Learning module | First real visual evidence | Introduced no earlier than |
| --- | --- | --- |
| 1. Containers/registry/runtime | Image references, Pod status, pull-related Events. | Phase 2 |
| 2. Core workloads | Ownership graph and readiness transitions. | Phase 1 |
| 3. Networking | Service selector edges and real Gateway traffic. | Phase 3 |
| 4. Configuration/storage | ConfigMap/PVC relationships and mounted state. | Phase 7 |
| 5. Scheduling/resources | Node placement, requests/limits, Pending reasons. | Phase 7 |
| 6. Health/self-healing | Probe state and deliberate Pod deletion. | Phase 4 |
| 7. Scaling | Replica count plus HPA/metrics state. | Phase 5 |
| 8. Rollouts | ReplicaSet replacement, revision, rollback. | Phase 6 |
| 9. Observability | Events, logs, metrics, then optional Prometheus/Grafana. | Phase 2 onward |

## Phased implementation roadmap

Each phase is independently runnable and leaves the current simulator usable.

### Phase 0 — Architecture contract and developer prerequisites (this milestone)

Deliverables: this document, source-of-truth rules, module map, a clear local
cluster/registry prerequisite, and a namespace-safety policy.

Exit criterion: a reader can distinguish current simulator workloads from the
future platform observer and knows what data is real versus simulated.

### Phase 1 — Read-only Cluster Explorer

Build only `backend/` and `frontend/` foundations. The backend reads one chosen
namespace via Kubernetes list/watch and serves `/api/snapshot` plus an SSE
stream. The frontend renders Namespace, Deployment, ReplicaSet, Pod, and
Service nodes with real status, a minimal timeline, and click-to-inspect raw
YAML/status.

Dependencies: a reachable local cluster and read-only Kubernetes credentials.

Exit criterion: deleting or recreating a current simulator Pod with `kubectl`
causes a visible, observed state transition in the browser without refreshing.

### Phase 2 — Object learning panel and trustworthy timeline

Add object-specific explanations, lifecycle views, selector/owner explanations,
Kubernetes Events, image/runtime information, and a clear source badge on every
timeline entry. Add content-driven Module 1 and Module 2 unlocks.

Dependencies: Phase 1 cache and stable snapshot contract.

Exit criterion: a learner can select a Pod and explain why its Deployment and
ReplicaSet exist using only information visible in the application.

### Phase 3 — Service networking and real traffic lab

Introduce the traffic runner as a controlled backend component. It generates
real requests to Gateway using the existing configurable pipeline and displays
Gateway → Service → selected Pod relationships. It exposes low-rate presets
first: validation-only, OCR-only, mixed, and heavy OCR.

Dependencies: Phase 1 topology, existing Gateway, and a safe local ingress or
port-forward target.

Exit criterion: changing a traffic preset creates real service requests and
observable application events without fabricating packet animations.

### Phase 4 — Health and self-healing lab

Add read-only probe/condition explanations, then one controlled action: delete
a labeled Pod. Visualize terminating, replacement Pod creation, readiness, and
traffic redistribution from observed state. Add reversible readiness/liveness
failure scenarios only after the deletion exercise is robust.

Dependencies: Phase 3 action audit and safety model; narrow mutating RBAC.

Exit criterion: a learner can trigger a labeled-Pod deletion and see the
Deployment restore the intended replica count, with cause and recovery clearly
separated.

### Phase 5 — Metrics and HPA lab

Integrate Metrics API sampling, show CPU/memory histories, add resource
requests/limits to teaching workloads, and introduce an HPA. Drive sustained,
bounded traffic with the runner and render HPA decisions, Pending → Running
Pod transitions, and cooldown.

Dependencies: Metrics Server installed, Phase 3 traffic runner, resource
requests, and HPA manifests.

Exit criterion: a learner can cause a real HPA scale-out and scale-in and see
the actual desired/current replica values and observed Pod lifecycle.

### Phase 6 — Rollouts and deployment strategies

Add image update, restart, rollback, and rollout-revision views. Start with
native RollingUpdate; introduce canary and blue/green as explicitly scoped
learning scenarios rather than pretending they are default Kubernetes behavior.

Dependencies: registry image workflow, Phase 1 ReplicaSet watcher, and action
audit trail.

Exit criterion: a rollout visibly links old/new ReplicaSets and a rollback
restores the selected revision.

### Phase 7 — Configuration, storage, and scheduling

Add ConfigMaps, Secrets (metadata only; never secret values), volumes, PVCs,
StorageClasses, Nodes, scheduling Events, requests/limits, QoS, affinity,
taints, and tolerations. Use intentionally constrained workloads to teach
Pending, insufficient-resource, and placement scenarios.

Dependencies: local storage provisioner, safe sandbox node labels/taints, and
an expanded read-only RBAC policy.

Exit criterion: the UI can explain a real Pending Pod's scheduling reason and
the relationship from Pod to configuration/storage resources.

### Phase 8 — Advanced observability and scenario catalog

Add log tailing with explicit size/rate limits, richer metrics, reusable
scenario definitions, save/reset environment controls, and optional local
Prometheus/Grafana integrations. VPA and cluster autoscaler stay labelled as
conceptual unless their required controllers are truly installed.

Dependencies: stable domain contracts, retention policy, and scenario reset
semantics.

Exit criterion: every supported exercise has a deterministic setup, safety
constraints, explanation, observable evidence, and reset procedure.

## Deliberate deferrals

- No arbitrary fault injection, node killing, or network partition tooling in
  early phases.
- No direct browser-to-Kubernetes API access.
- No cloud cluster, cloud metrics, identity provider, or production credentials.
- No simulated HPA, VPA, or autoscaler result presented as a real cluster fact.
- No Prometheus or Grafana until the platform can explain the Kubernetes-native
  state and event flow first.

## Next approval point

Approve Phase 1 before code is added. Its implementation should create only the
minimum backend/frontend skeleton, read-only RBAC assets, a namespace selector,
the list/watch cache, snapshot/SSE endpoints, and the first real topology view.
