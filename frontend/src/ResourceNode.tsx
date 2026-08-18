import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ExplorerNode } from './graph';

export function ResourceNode({ data, selected }: NodeProps<ExplorerNode>) {
  const { resource } = data;
  const statusTone = resource.status.includes('Ready') || resource.status === 'Active' || resource.status === 'Running' ? 'healthy' : resource.status.includes('Failed') || resource.status.includes('NotReady') ? 'unhealthy' : 'pending';
  return (
    <div className={`resource-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="resource-topline"><span className="resource-kind">{resource.kind}</span><span className={`status-dot ${statusTone}`} /></div>
      <div className="resource-name" title={resource.name}>{resource.name}</div>
      <div className="resource-status" title={resource.status}>{resource.status}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
