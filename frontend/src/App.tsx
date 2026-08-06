import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler } from '@xyflow/react';
import type { ClusterResource, ClusterSnapshot } from '@simulator/shared/platform-contract';
import { buildGraph, type ExplorerNodeData } from './graph';
import { Inspector } from './Inspector';
import { ResourceNode } from './ResourceNode';

const emptySnapshot: ClusterSnapshot = { generatedAt: '', resources: [], events: [], observerErrors: [] };

async function loadSnapshot(): Promise<ClusterSnapshot> {
  const response = await fetch('/snapshot');
  if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
  return response.json() as Promise<ClusterSnapshot>;
}

export function App() {
  const [snapshot, setSnapshot] = useState<ClusterSnapshot>(emptySnapshot);
  const [selected, setSelected] = useState<ClusterResource>();
  const [error, setError] = useState<string>();
  const graph = useMemo(() => buildGraph(snapshot), [snapshot]);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadSnapshot());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const source = new EventSource('/events');
    source.addEventListener('snapshot', (event) => setSnapshot(JSON.parse((event as MessageEvent).data) as ClusterSnapshot));
    source.addEventListener('cluster-update', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { snapshot: ClusterSnapshot };
      setSnapshot(payload.snapshot);
    });
    source.onerror = () => setError('Live connection interrupted. The browser will retry automatically.');
    return () => source.close();
  }, [refresh]);

  const selectNode: NodeMouseHandler = (_, node) => setSelected((node.data as ExplorerNodeData).resource);
  return (
    <main className="app-shell">
      <header>
        <div><p className="eyebrow">PHASE 1 · READ-ONLY</p><h1>Kubernetes Cluster Explorer</h1></div>
        <div className="connection"><span className={error ? 'offline-dot' : 'online-dot'} /> {error ?? `Live · ${snapshot.resources.length} objects`}</div>
      </header>
      {snapshot.observerErrors.length > 0 && <div className="observer-warning">Observer: {snapshot.observerErrors.at(-1)}</div>}
      <section className="explorer-layout">
        <div className="canvas">
          <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={{ resource: ResourceNode }} onNodeClick={selectNode} fitView minZoom={0.1} maxZoom={2}>
            <Background gap={18} size={1} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <Inspector resource={selected} />
      </section>
    </main>
  );
}
