import type { ClusterKind, ClusterStatistics } from '@kubeverse/shared';
import { clusterKinds } from '@kubeverse/shared';

export function ExplorerControls({ namespaces, namespace, setNamespace, search, setSearch, visibleKinds, toggleKind, statistics }: {
  namespaces: string[]; namespace: string; setNamespace: (value: string) => void; search: string; setSearch: (value: string) => void;
  visibleKinds: Set<string>; toggleKind: (kind: ClusterKind) => void; statistics?: ClusterStatistics;
}) {
  return <section className="controls-panel">
    <label>Namespace<select value={namespace} onChange={(event) => setNamespace(event.target.value)}><option value="">All namespaces</option>{namespaces.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="name, kind, namespace" /></label>
    <div className="counters"><span>Pods {statistics?.readyPods ?? 0}/{statistics?.totalPods ?? 0}</span><span>Nodes {statistics?.readyNodes ?? 0}/{statistics?.totalNodes ?? 0}</span></div>
    <details><summary>Resource filters</summary><div className="kind-filters">{clusterKinds.map((kind) => <label key={kind}><input type="checkbox" checked={visibleKinds.has(kind)} onChange={() => toggleKind(kind)} />{kind}</label>)}</div></details>
  </section>;
}
