import type { ClusterKind, ClusterStatistics } from '@kubeverse/shared';
import { clusterKinds } from '@kubeverse/shared';
import { PopoverDropdown } from './components/PopoverDropdown';

// No namespace selector here: the Playground is scoped to one KubeVerse
// project (via ?projectId= on the backend), and a project's generated
// resources always live in exactly one namespace - the old per-namespace
// filter had nothing left to do, and would have hidden cluster-scoped Nodes
// (which have no namespace) if left in place.
export function ExplorerControls({ search, setSearch, visibleKinds, toggleKind, statistics, onFit, onReset }: {
  search: string; setSearch: (value: string) => void;
  visibleKinds: Set<string>; toggleKind: (kind: ClusterKind) => void; statistics?: ClusterStatistics; onFit: () => void; onReset: () => void;
}) {
  return <section className="controls-panel">
    <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="name, kind, namespace" /></label>
    <PopoverDropdown label="Filters">
      <div className="kind-filters">{clusterKinds.map((kind) => <label key={kind}><input type="checkbox" checked={visibleKinds.has(kind)} onChange={() => toggleKind(kind)} />{kind}</label>)}</div>
    </PopoverDropdown>
    <div className="toolbar-buttons">
      <button onClick={onFit}>Fit</button>
      <button onClick={onReset}>Reset</button>
    </div>
    <div className="counters"><span>Pods {statistics?.readyPods ?? 0}/{statistics?.totalPods ?? 0}</span><span>Nodes {statistics?.readyNodes ?? 0}/{statistics?.totalNodes ?? 0}</span></div>
  </section>;
}
