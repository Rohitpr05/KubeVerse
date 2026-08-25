import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react';
import { clusterKinds, type ClusterResource, type ClusterSnapshot, type ResourceGraph } from '@kubeverse/shared';
import { buildFlowGraph, type ExplorerNodeData } from '../graph';
import { Inspector } from '../Inspector';
import { ResourceNode } from '../ResourceNode';
import { ExplorerControls } from '../ExplorerControls';
import { Timeline } from '../Timeline';
import { api, type EnvironmentStatus, type ProjectSummary } from '../api';
import type { ViewId } from '../shell/Sidebar';

const emptySnapshot: ClusterSnapshot = {
  generatedAt: '', resources: [], events: [], observerErrors: [],
  statistics: { generatedAt: '', resourceCounts: {}, readyPods: 0, totalPods: 0, readyNodes: 0, totalNodes: 0 }
};

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
export function PlaygroundView({ currentProject, navigate }: { currentProject: ProjectSummary | undefined; navigate: (view: ViewId) => void }) {
  const [snapshot, setSnapshot] = useState<ClusterSnapshot>(emptySnapshot);
  const [resourceGraph, setResourceGraph] = useState<ResourceGraph>();
  const [selected, setSelected] = useState<ClusterResource>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [visibleKinds, setVisibleKinds] = useState<Set<string>>(() => new Set(clusterKinds));
  const [flow, setFlow] = useState<ReactFlowInstance>();
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [retryKey, setRetryKey] = useState(0);
  const projectId = currentProject?.id;
  const graph = useMemo(() => buildFlowGraph(snapshot.resources, resourceGraph, visibleKinds, search), [snapshot.resources, resourceGraph, visibleKinds, search]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const [nextSnapshot, nextGraph] = await Promise.all([loadSnapshot(projectId), loadGraph(projectId)]);
      setSnapshot(nextSnapshot);
      setResourceGraph(nextGraph);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId]);

  // Switching projects starts from a clean slate rather than showing the
  // previous project's resources until the new fetch resolves.
  useEffect(() => {
    setSnapshot(emptySnapshot);
    setResourceGraph(undefined);
    setSelected(undefined);
    setError(undefined);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void refresh();
    const source = new EventSource(`/events?projectId=${encodeURIComponent(projectId)}`);
    source.addEventListener('snapshot', (event) => setSnapshot(JSON.parse((event as MessageEvent).data) as ClusterSnapshot));
    source.addEventListener('cluster-update', () => { void refresh(); });
    source.onerror = () => setError('Live connection interrupted. The browser will retry automatically.');
    return () => source.close();
  }, [refresh, projectId, retryKey]);

  useEffect(() => {
    if (!flow || graph.nodes.length === 0) return;
    const frame = requestAnimationFrame(() => flow.fitView({ padding: 0.16, minZoom: 0.25, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, graph.nodes.length, graph.edges.length]);

  // Keep an open inspector synchronized with the latest resource cache without
  // changing the user's selection or reloading the page.
  useEffect(() => {
    if (!selected) return;
    const currentResource = snapshot.resources.find((resource) => resource.uid === selected.uid);
    setSelected(currentResource);
  }, [snapshot.resources, selected?.uid]);

  const unavailable = snapshot.resources.length === 0 && (Boolean(error) || snapshot.observerErrors.length > 0);

  useEffect(() => {
    if (!unavailable) return;
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
  }, [unavailable, retryKey]);

  function retry() {
    setRetryKey((key) => key + 1);
    void refresh();
    void api.getEnvironment().then(setEnvironment).catch(() => undefined);
  }

  const selectNode: NodeMouseHandler = (_, node) => setSelected((node.data as ExplorerNodeData).resource);
  const toggleKind = (kind: typeof clusterKinds[number]) => setVisibleKinds((current) => {
    const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next;
  });
  if (!currentProject) {
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
      />

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
        <section className="explorer-layout">
          <div className="canvas">
            <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={{ resource: ResourceNode }} onNodeClick={selectNode} onInit={setFlow} fitView fitViewOptions={{ padding: 0.16, minZoom: 0.25, maxZoom: 1 }} minZoom={0.15} maxZoom={2}>
              <Background gap={18} size={1} />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
          <aside className="side-panel"><Inspector resource={selected} /><Timeline events={snapshot.events} /></aside>
        </section>
        </>
      )}
    </div>
  );
}
