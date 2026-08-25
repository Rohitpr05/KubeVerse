import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, Panel, ReactFlow, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react';
import { clusterKinds, type ClusterResource, type ClusterSnapshot, type ResourceGraph } from '@kubeverse/shared';
import { buildFlowGraph, type ExplorerNodeData } from '../graph';
import { Inspector } from '../Inspector';
import { ResourceNode } from '../ResourceNode';
import { ExplorerControls } from '../ExplorerControls';
import { Timeline } from '../Timeline';

const emptySnapshot: ClusterSnapshot = {
  generatedAt: '', resources: [], events: [], observerErrors: [],
  statistics: { generatedAt: '', resourceCounts: {}, readyPods: 0, totalPods: 0, readyNodes: 0, totalNodes: 0 }
};

async function loadSnapshot(): Promise<ClusterSnapshot> {
  const response = await fetch('/snapshot');
  if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
  return response.json() as Promise<ClusterSnapshot>;
}

async function loadGraph(namespace?: string): Promise<ResourceGraph> {
  const response = await fetch(`/graph${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`);
  if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
  return response.json() as Promise<ResourceGraph>;
}

// The generic, real-cluster read-only explorer. It observes whatever
// workloads are running in the target cluster - KubeVerse-generated or
// otherwise - with no assumptions about any particular architecture.
export function PlaygroundView() {
  const [snapshot, setSnapshot] = useState<ClusterSnapshot>(emptySnapshot);
  const [resourceGraph, setResourceGraph] = useState<ResourceGraph>();
  const [selected, setSelected] = useState<ClusterResource>();
  const [error, setError] = useState<string>();
  const [namespace, setNamespace] = useState('');
  const [search, setSearch] = useState('');
  const [visibleKinds, setVisibleKinds] = useState<Set<string>>(() => new Set(clusterKinds));
  const [flow, setFlow] = useState<ReactFlowInstance>();
  const graph = useMemo(() => buildFlowGraph(snapshot.resources, resourceGraph, visibleKinds, search), [snapshot.resources, resourceGraph, visibleKinds, search]);

  const refresh = useCallback(async () => {
    try {
      const [nextSnapshot, nextGraph] = await Promise.all([loadSnapshot(), loadGraph(namespace)]);
      setSnapshot(nextSnapshot);
      setResourceGraph(nextGraph);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [namespace]);

  useEffect(() => {
    void refresh();
    const source = new EventSource('/events');
    source.addEventListener('snapshot', (event) => setSnapshot(JSON.parse((event as MessageEvent).data) as ClusterSnapshot));
    source.addEventListener('cluster-update', () => { void refresh(); });
    source.onerror = () => setError('Live connection interrupted. The browser will retry automatically.');
    return () => source.close();
  }, [refresh]);

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

  const selectNode: NodeMouseHandler = (_, node) => setSelected((node.data as ExplorerNodeData).resource);
  const toggleKind = (kind: typeof clusterKinds[number]) => setVisibleKinds((current) => {
    const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next;
  });
  const namespaceNames = snapshot.resources.filter((resource) => resource.kind === 'Namespace').map((resource) => resource.name).sort();
  return (
    <div className="playground-view">
      {snapshot.observerErrors.length > 0 && <div className="observer-warning">Observer: {snapshot.observerErrors.at(-1)}</div>}
      {error && <div className="observer-warning">{error}</div>}
      <ExplorerControls namespaces={namespaceNames} namespace={namespace} setNamespace={setNamespace} search={search} setSearch={setSearch} visibleKinds={visibleKinds} toggleKind={toggleKind} statistics={snapshot.statistics} />
      <section className="explorer-layout">
        <div className="canvas">
          <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={{ resource: ResourceNode }} onNodeClick={selectNode} onInit={setFlow} fitView fitViewOptions={{ padding: 0.16, minZoom: 0.25, maxZoom: 1 }} minZoom={0.15} maxZoom={2}>
            <Background gap={18} size={1} />
            <Controls />
            <MiniMap />
            <Panel position="top-left" className="canvas-actions">
              <button onClick={() => flow?.fitView({ padding: 0.16, minZoom: 0.25, maxZoom: 1 })}>Fit View</button>
              <button onClick={() => flow?.setViewport({ x: 0, y: 0, zoom: 1 })}>Reset View</button>
            </Panel>
          </ReactFlow>
        </div>
        <aside className="side-panel"><Inspector resource={selected} /><Timeline events={snapshot.events} /></aside>
      </section>
    </div>
  );
}
