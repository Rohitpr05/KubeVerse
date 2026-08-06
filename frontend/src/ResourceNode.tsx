import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ExplorerNode } from './graph';

export function ResourceNode({ data, selected }: NodeProps<ExplorerNode>) {
  const { resource } = data;
  return (
    <div className={`resource-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="resource-kind">{resource.kind}</div>
      <div className="resource-name">{resource.name}</div>
      <div className="resource-status">{resource.status}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
