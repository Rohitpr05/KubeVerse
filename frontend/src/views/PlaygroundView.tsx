import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState, type Edge, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react';
import { clusterKinds, type ClusterResource, type ClusterSnapshot, type LabExperiment, type ResourceGraph } from '@kubeverse/shared';
import { buildExplorerEdges, filterVisible, layoutAllNodes, NODE_HEIGHT, NODE_WIDTH, reconcileNodes, type ExplorerNode, type ExplorerNodeData } from '../graph';
import { Inspector } from '../Inspector';
import { ResourceNode } from '../ResourceNode';
import { ExplorerControls } from '../ExplorerControls';
import { api, type EnvironmentStatus, type ProjectSummary } from '../api';
import { shouldResetForProjectChange } from '../playgroundState';
import { LabPanel } from '../lab/LabPanel';
import { LabDrawer } from '../lab/LabDrawer';
import { ActivityStrip } from '../lab/ActivityStrip';
import { TrafficParticles, type Particle } from '../lab/TrafficParticles';
import type { ViewId } from '../shell/Sidebar';

const MAX_EXPERIMENTS_SHOWN = 20;
const PARTICLE_LIFETIME_MS = 700;
// Intensity scaling (UX refinement, Part 7): a burst's particle count is
// derived from how many requests actually landed since the last progress
// tick, not from the tick cadence itself (which is roughly constant
// regardless of RPS - see backend/src/lab/trafficRunner.ts's
// PROGRESS_INTERVAL_MS) - otherwise 10 RPS and 100 RPS would look visually
// identical. Capped so a very high RPS run still only ever renders a
// bounded number of DOM particles at once (Part 20).
const PARTICLES_PER_REQUESTS = 4;
const MAX_PARTICLES_PER_TICK = 8;
const MAX_LIVE_PARTICLES = 40;

function upsertExperiment(list: LabExperiment[], next: LabExperiment): LabExperiment[] {
  const withoutNext = list.filter((experiment) => experiment.id !== next.id);
  return [next, ...withoutNext].slice(0, MAX_EXPERIMENTS_SHOWN);
}

function nodeCenter(nodes: ExplorerNode[], kind: string, namespace: string | undefined, name: string): { x: number; y: number } | undefined {
  const node = nodes.find((candidate) => candidate.data.resource.kind === kind && candidate.data.resource.namespace === namespace && candidate.data.resource.name === name);
  return node ? { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + NODE_HEIGHT / 2 } : undefined;
}

function nodeKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}:${namespace ?? ''}:${name}`;
}

const emptySnapshot: ClusterSnapshot = {
  generatedAt: '', resources: [], events: [], observerErrors: [],
  statistics: { generatedAt: '', resourceCounts: {}, readyPods: 0, totalPods: 0, readyNodes: 0, totalNodes: 0 }
};

// How long a lost `currentProject` is tolerated as "probably transient"
// before the Playground actually reverts to the true empty state. Nothing
// in the app currently has a "close project" action, so once a project has
// loaded successfully, `currentProject` becoming undefined is never an
// intentional transition - it is treated as a hiccup to ride out, not a
// reason to blank the topology.
const LOST_PROJECT_GRACE_MS = 6000;

async function loadSnapshot(projectId: string): Promise<ClusterSnapshot> {
  const response = await fetch(`/snapshot?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
  return response.json() as Promise<ClusterSnapshot>;
}

async function loadGraph(projectId: string): Promise<ResourceGraph> {
  const response = await fetch(`/graph?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
  return response.json() as Promise<ResourceGraph>;
}

// The KubeVerse Playground: a read-only live view of ONE project's real
// Kubernetes resources - never the whole cluster. Ownership is decided
// entirely by the backend (kubeverse.dev/project-id labels, see
// backend/src/ownership.ts and cluster-state.ts's project* methods); this
// component just always asks for `currentProject.id` and never falls back to
// unscoped data. "How is MY architecture running?", not "what's on this
// cluster?" (KUBEVERSE_MASTER_SPEC.md).
//
// State-update contract (see the root-cause writeup for how this was found):
//  - snapshot and resourceGraph are committed ONLY together, from one place
//    (refresh()), never independently - there is exactly one writer, so the
//    two can never observably disagree with each other for a render.
//  - At most one refresh() is ever in flight; an update signal that arrives
//    while one is running is coalesced into a single trailing follow-up
//    instead of firing a second overlapping fetch (this is what "many
//    Kubernetes updates -> one coherent graph update" means here - no
//    timer, no added latency on the first request).
//  - The graph is only ever reset to empty for a *confirmed* project change
//    (a different project id actually loaded successfully) or a genuine
//    "no project has ever loaded" state - never merely because
//    `currentProject` went briefly undefined, which is what was actually
//    causing the reported disappearing-topology bug.
export function PlaygroundView({ currentProject, navigate }: { currentProject: ProjectSummary | undefined; navigate: (view: ViewId) => void }) {
  const [snapshot, setSnapshot] = useState<ClusterSnapshot>(emptySnapshot);
  const [resourceGraph, setResourceGraph] = useState<ResourceGraph>();
  const [selected, setSelected] = useState<ClusterResource>();
  const [error, setError] = useState<string>();
  const [updating, setUpdating] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleKinds, setVisibleKinds] = useState<Set<string>>(() => new Set(clusterKinds));
  const [flow, setFlow] = useState<ReactFlowInstance<ExplorerNode, Edge>>();
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [retryKey, setRetryKey] = useState(0);
  const [locked, setLocked] = useState(true);
  const [experiments, setExperiments] = useState<LabExperiment[]>([]);
  const [activeExperimentId, setActiveExperimentId] = useState<string>();
  const [particles, setParticles] = useState<Particle[]>([]);
  const [labError, setLabError] = useState<string>();
  // Lab Controls is a slide-over drawer, not a permanent layout column (UX
  // refinement, Part 1) - closed by default so the topology gets maximum
  // space until the learner actually wants to run an experiment (Part 16).
  const [labDrawerOpen, setLabDrawerOpen] = useState(false);
  // Inspector collapse (Part 17) - purely a width/visibility toggle; Inspector
  // itself stays mounted either way, so its own polling effects and any
  // in-progress state are untouched by collapsing it.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const projectId = currentProject?.id;
  const lastTrafficSentRef = useRef<Map<string, number>>(new Map());
  const particleCursorRef = useRef(0);

  // React-Flow-owned topology state (Task 5): this - not resourceGraph - is
  // the single source of truth for node *position*. resourceGraph only ever
  // drives it through reconcileNodes (data updates in place, positions
  // preserved) or layoutAllNodes (an explicit full re-layout: first load,
  // project switch, or the Auto Layout button) - never through a second
  // parallel graph/state system.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ExplorerNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Tracks which project the data currently on screen actually belongs to -
  // separate from the `projectId` prop, precisely so a transient loss of
  // `currentProject` doesn't look like "the project changed" to this effect.
  const loadedProjectIdRef = useRef<string | undefined>(undefined);
  const requestedProjectIdRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const graceTimerRef = useRef<number | undefined>(undefined);

  // Task 2/5: reconciles every snapshot/graph update into the existing
  // React-Flow-owned node list - existing nodes keep their exact position
  // (auto-laid-out or user-dragged) and only get fresh data; a brand new
  // resource gets a position from one fresh layout pass. This never
  // recomputes the whole topology's positions on an ordinary status change
  // (e.g. Pod Running -> CrashLoopBackOff), and it's also what naturally
  // clears the canvas when resourceGraph is reset to undefined for a project
  // switch (see the effect above) - reconcileNodes(_, _, undefined) => [].
  useEffect(() => {
    setRfNodes((current) => reconcileNodes(current, snapshot.resources, resourceGraph));
    setRfEdges(buildExplorerEdges(resourceGraph));
  }, [snapshot.resources, resourceGraph, setRfNodes, setRfEdges]);

  // Pure visibility filter (Task 5): never touches position, so toggling a
  // kind filter or typing a search term can't move a single node.
  const { nodes: visibleNodes, edges: visibleEdges } = useMemo(
    () => filterVisible(rfNodes, rfEdges, visibleKinds, search),
    [rfNodes, rfEdges, visibleKinds, search],
  );

  // Task 4: a full re-layout, run only on explicit request - never on an
  // ordinary data update (see the reconciliation effect above). Fits the
  // camera to the result afterward, same as a fresh project load.
  const applyAutoLayout = useCallback(() => {
    if (!resourceGraph) return;
    setRfNodes(layoutAllNodes(snapshot.resources, resourceGraph));
    requestAnimationFrame(() => flow?.fitView({ padding: 0.16, minZoom: 0.25, maxZoom: 1 }));
  }, [resourceGraph, snapshot.resources, flow, setRfNodes]);

  // Applies one Lab experiment update (from the initial GET or a `lab-update`
  // SSE event - see the SSE effect below) into local state, and - only for a
  // traffic experiment whose measured `sent` count actually grew since the
  // last update - spawns a small burst of aggregated traffic particles
  // animating from the target Service's node toward its *currently* real
  // target Pods (traffic.targetPods, the same live-refreshed list
  // lab/trafficRunner.ts is actually sending requests to - see routes/lab.ts's
  // resolveReadyTargets). This is the only place particles are created:
  // never per-request (burst size scales with requests-since-last-tick, not
  // 1:1 - Part 7), never for a kind other than 'traffic', and never pointed
  // at a Pod that isn't a real, currently-eligible endpoint (Part 8/14) -
  // when a Pod fails mid-run its name drops out of targetPods on the very
  // next backend tick, so particles simply stop being aimed at it.
  const applyExperimentUpdate = useCallback((experiment: LabExperiment) => {
    setExperiments((current) => upsertExperiment(current, experiment));

    const traffic = experiment.traffic;
    if (experiment.kind === 'traffic' && traffic && traffic.targetPods.length > 0) {
      const previousSent = lastTrafficSentRef.current.get(experiment.id) ?? 0;
      const deltaSent = traffic.sent - previousSent;
      if (deltaSent > 0) {
        lastTrafficSentRef.current.set(experiment.id, traffic.sent);
        const from = nodeCenter(rfNodes, experiment.target.kind, experiment.target.namespace, experiment.target.name);
        if (from) {
          const burstSize = Math.max(1, Math.min(MAX_PARTICLES_PER_TICK, Math.round(deltaSent / PARTICLES_PER_REQUESTS)));
          const newParticles: Particle[] = [];
          for (let i = 0; i < burstSize; i += 1) {
            const podName = traffic.targetPods[particleCursorRef.current % traffic.targetPods.length];
            particleCursorRef.current += 1;
            const to = nodeCenter(rfNodes, 'Pod', experiment.target.namespace, podName);
            if (!to) continue;
            // `ok` reflects this batch's overall error rate, not one specific
            // request's outcome - trafficRunner reports cumulative stats, not
            // a per-request success flag, so that's the only honest signal
            // available for this particle's styling (Part 14 - never claim
            // "this exact request went through this Pod").
            newParticles.push({ id: `${experiment.id}:${traffic.sent}:${i}`, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, ok: traffic.errorRate < 0.5 });
          }
          if (newParticles.length > 0) {
            const ids = new Set(newParticles.map((particle) => particle.id));
            setParticles((current) => [...current, ...newParticles].slice(-MAX_LIVE_PARTICLES));
            setTimeout(() => setParticles((current) => current.filter((particle) => !ids.has(particle.id))), PARTICLE_LIFETIME_MS);
          }
        }
      }
    }
    if (experiment.status === 'preparing' || experiment.status === 'running') setActiveExperimentId(experiment.id);
  }, [rfNodes]);

  const refresh = useCallback(async () => {
    const targetProjectId = requestedProjectIdRef.current;
    if (!targetProjectId) return;
    if (inFlightRef.current) { pendingRef.current = true; return; }
    inFlightRef.current = true;
    setUpdating(true);
    try {
      const [nextSnapshot, nextGraph] = await Promise.all([loadSnapshot(targetProjectId), loadGraph(targetProjectId)]);
      // The requested project may have changed while this was in flight (a
      // real switch, or the grace-period project coming back under a
      // different id) - a stale response must never overwrite what's
      // current now.
      if (requestedProjectIdRef.current !== targetProjectId) return;
      // Atomic commit: both fields land in the same render, from the one
      // place that ever sets either of them.
      setSnapshot(nextSnapshot);
      setResourceGraph(nextGraph);
      setError(undefined);
      loadedProjectIdRef.current = targetProjectId;
    } catch (cause) {
      if (requestedProjectIdRef.current !== targetProjectId) return;
      // Task 9: a transient fetch failure surfaces as an error banner: it
      // never clears snapshot/resourceGraph, so the last good topology stays
      // visible underneath it.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlightRef.current = false;
      setUpdating(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void refresh();
      }
    }
  }, []);

  // The only place that decides whether to reset to empty. A reset happens
  // for a *confirmed* different project (or the very first project this
  // component has ever seen) - never merely because `projectId` is
  // momentarily undefined after a project was already loaded.
  useEffect(() => {
    requestedProjectIdRef.current = projectId;
    if (graceTimerRef.current) { window.clearTimeout(graceTimerRef.current); graceTimerRef.current = undefined; }

    if (projectId) {
      if (shouldResetForProjectChange(loadedProjectIdRef.current, projectId)) {
        // A real switch (including "first project ever loaded"): start clean.
        setSnapshot(emptySnapshot);
        setResourceGraph(undefined);
        setSelected(undefined);
        setError(undefined);
        setUpdating(false);
      }
      return;
    }

    // projectId just went away. If nothing has ever loaded, this is a
    // genuine "no project" state - show it immediately. If something HAD
    // loaded, give it a grace period to come back (see LOST_PROJECT_GRACE_MS)
    // before treating it as real; nothing in the current UI has a "close
    // project" action, so a lasting loss here would itself indicate a bug
    // elsewhere, not a user choice.
    if (!shouldResetForProjectChange(loadedProjectIdRef.current, undefined)) {
      graceTimerRef.current = window.setTimeout(() => {
        if (requestedProjectIdRef.current) return; // recovered before the timer fired
        loadedProjectIdRef.current = undefined;
        setSnapshot(emptySnapshot);
        setResourceGraph(undefined);
        setSelected(undefined);
        setError(undefined);
        setUpdating(false);
      }, LOST_PROJECT_GRACE_MS);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void refresh();
    void api.listExperiments(projectId).then(({ experiments: initial }) => setExperiments(initial)).catch(() => undefined);
    const source = new EventSource(`/events?projectId=${encodeURIComponent(projectId)}`);
    // Both event types are treated purely as "something may have changed,
    // reconcile" signals - neither applies its payload directly. That keeps
    // there being exactly one writer of snapshot/resourceGraph (refresh()),
    // so the two can't ever land in different renders relative to each other.
    source.addEventListener('snapshot', () => { void refresh(); });
    source.addEventListener('cluster-update', () => { void refresh(); });
    // Lab experiment progress/transitions (Phase 2) - a separate event type
    // on the same per-project stream, applied directly since each payload
    // IS the full current experiment, not a delta to reconcile.
    source.addEventListener('lab-update', (event) => applyExperimentUpdate(JSON.parse((event as MessageEvent).data) as LabExperiment));
    source.onerror = () => setError('Live connection interrupted. The browser will retry automatically.');
    return () => source.close();
  }, [refresh, projectId, retryKey, applyExperimentUpdate]);

  // Switching projects must also clear the previous project's experiments/
  // particles - they're just as project-scoped as the topology itself.
  useEffect(() => {
    setExperiments([]);
    setActiveExperimentId(undefined);
    setParticles([]);
    lastTrafficSentRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!flow || visibleNodes.length === 0) return;
    const frame = requestAnimationFrame(() => flow.fitView({ padding: 0.16, minZoom: 0.25, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, visibleNodes.length, visibleEdges.length]);

  // Keep an open inspector synchronized with the latest resource cache without
  // changing the user's selection or reloading the page.
  useEffect(() => {
    if (!selected) return;
    const currentResource = snapshot.resources.find((resource) => resource.uid === selected.uid);
    setSelected(currentResource);
  }, [snapshot.resources, selected?.uid]);

  // Only the "never had any data" case counts as genuinely unavailable - once
  // real resources have been shown, a transient error becomes a banner
  // (below), not a full-screen replacement of the topology (Task 9).
  const unavailable = snapshot.resources.length === 0 && !loadedProjectIdRef.current && (Boolean(error) || snapshot.observerErrors.length > 0);

  useEffect(() => {
    if (!unavailable) return;
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
  }, [unavailable, retryKey]);

  function retry() {
    setRetryKey((key) => key + 1);
    void refresh();
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
  }

  const activeExperiment = experiments.find((experiment) => experiment.id === activeExperimentId);

  // Which topology nodes to visually call out as "part of the active
  // experiment" (UX refinement, Part 10): the experiment's own target
  // (Pod/Deployment for the mutating kinds) plus whichever Pod its most
  // recent transition naming a *different* Pod refers to - in practice, the
  // replacement Pod, the moment Kubernetes actually reports it, never
  // before. Deliberately only the most recent one, not every distinct Pod
  // ever mentioned: the backend tracks transitions per-ReplicaSet (see
  // backend/src/lab/experiments.ts), so an unrelated sibling Pod under the
  // same ReplicaSet reporting an incidental status blip during the same
  // window would otherwise light up too, which would misrepresent "the
  // affected Pod" as a whole group. Traffic experiments don't get this
  // treatment - their Service/Pods are already highlighted by the traffic
  // particles animating through them.
  const highlightedKeys = useMemo(() => {
    const isLive = activeExperiment?.status === 'preparing' || activeExperiment?.status === 'running';
    if (!activeExperiment || !isLive || activeExperiment.kind === 'traffic') return null;
    const keys = new Set<string>();
    keys.add(nodeKey(activeExperiment.target.kind, activeExperiment.target.namespace, activeExperiment.target.name));
    for (let i = activeExperiment.transitions.length - 1; i >= 0; i -= 1) {
      const transition = activeExperiment.transitions[i];
      if (transition.kind === 'Pod' && transition.name !== activeExperiment.target.name) {
        keys.add(nodeKey('Pod', activeExperiment.target.namespace, transition.name));
        break;
      }
    }
    return keys;
  }, [activeExperiment]);

  const nodesForRender = useMemo(() => {
    if (!highlightedKeys || highlightedKeys.size === 0) return visibleNodes;
    return visibleNodes.map((node) => {
      const key = nodeKey(node.data.resource.kind, node.data.resource.namespace, node.data.resource.name);
      return highlightedKeys.has(key) ? { ...node, data: { ...node.data, highlighted: true } } : node;
    });
  }, [visibleNodes, highlightedKeys]);

  const selectNode: NodeMouseHandler = (_, node) => setSelected((node.data as ExplorerNodeData).resource);
  const toggleKind = (kind: typeof clusterKinds[number]) => setVisibleKinds((current) => {
    const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next;
  });

  if (!currentProject && !loadedProjectIdRef.current) {
    return (
      <div className="playground-view">
        <div className="view">
          <h1>Playground</h1>
          <section className="empty-hero">
            <h2>Open a project first</h2>
            <p className="muted">The Playground shows one KubeVerse project's real Kubernetes resources - open or create a project to see it here.</p>
            <div className="settings-actions"><button onClick={() => navigate('projects')}>Go to Projects</button></div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="playground-view">
      <ExplorerControls
        search={search}
        setSearch={setSearch}
        visibleKinds={visibleKinds}
        toggleKind={toggleKind}
        statistics={snapshot.statistics}
        onFit={() => flow?.fitView({ padding: 0.16, minZoom: 0.25, maxZoom: 1 })}
        onReset={() => flow?.setViewport({ x: 0, y: 0, zoom: 1 })}
        locked={locked}
        onToggleLock={() => setLocked((current) => !current)}
        onAutoLayout={applyAutoLayout}
        labDrawerOpen={labDrawerOpen}
        onToggleLabDrawer={() => setLabDrawerOpen((current) => !current)}
      />

      {/* The drawer always renders (see LabDrawer.tsx) - it never reserves
          layout width, it only overlays via position:fixed, so it's safe to
          mount unconditionally alongside the rest of the Playground. */}
      {projectId && (
        <LabDrawer open={labDrawerOpen} onClose={() => setLabDrawerOpen(false)}>
          <LabPanel
            projectId={projectId}
            resources={snapshot.resources}
            resourceGraph={resourceGraph}
            events={snapshot.events}
            activeExperiment={activeExperiment}
            onExperimentStarted={applyExperimentUpdate}
            onError={setLabError}
          />
        </LabDrawer>
      )}

      {unavailable ? (
        <div className="cluster-unavailable">
          <h2>Kubernetes unavailable</h2>
          <p>KubeVerse cannot currently reach the configured Kubernetes cluster.</p>
          {snapshot.observerErrors.length > 0 && <p className="error">{snapshot.observerErrors.at(-1)}</p>}
          {error && <p className="error">{error}</p>}
          <dl>
            <dt>Context</dt><dd>{environment?.kubernetes.context ?? 'unknown'}</dd>
            <dt>API</dt><dd>{environment?.kubernetes.server ?? environment?.kubernetes.error ?? 'unreachable'}</dd>
          </dl>
          <div className="settings-actions"><button onClick={retry}>Retry</button></div>
          <p className="muted">KubeVerse keeps watching in the background and will reconnect automatically once the cluster is reachable.</p>
        </div>
      ) : (
        <>
        {snapshot.observerErrors.length > 0 && <div className="observer-warning">Observer: {snapshot.observerErrors.at(-1)}</div>}
        {error ? (
          <div className="observer-warning">⚠ Unable to refresh cluster state - retrying… ({error})</div>
        ) : (!currentProject || updating) && (
          <div className="observer-warning updating">{!currentProject ? 'Reconnecting to project…' : 'Updating cluster state…'}</div>
        )}
        {labError && <div className="observer-warning error" onClick={() => setLabError(undefined)}>⚠ {labError} (click to dismiss)</div>}
        <div className="playground-body">
        <section className={`explorer-layout ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
          <div className="canvas">
            <ReactFlow<ExplorerNode>
              nodes={nodesForRender}
              edges={visibleEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodesDraggable={!locked}
              nodeTypes={{ resource: ResourceNode }}
              onNodeClick={selectNode}
              onInit={setFlow}
              fitView
              fitViewOptions={{ padding: 0.16, minZoom: 0.25, maxZoom: 1 }}
              minZoom={0.15}
              maxZoom={2}
            >
              <Background gap={18} size={1} />
              <Controls />
              <MiniMap />
              <TrafficParticles particles={particles} />
            </ReactFlow>
          </div>
          <aside className={`side-panel ${inspectorCollapsed ? 'collapsed' : ''}`}>
            <button
              className="side-panel-toggle"
              onClick={() => setInspectorCollapsed((current) => !current)}
              title={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
            >
              {inspectorCollapsed ? '‹' : '›'}
            </button>
            <div className="side-panel-body scroll-clean"><Inspector resource={selected} /></div>
          </aside>
        </section>
        <ActivityStrip experiments={experiments} events={snapshot.events} />
        </div>
        </>
      )}
    </div>
  );
}
