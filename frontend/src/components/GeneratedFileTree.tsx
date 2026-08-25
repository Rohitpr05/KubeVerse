import { useState } from 'react';
import { api, type GeneratedFileRecord } from '../api';

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: Map<string, TreeNode>;
}

function buildTree(files: GeneratedFileRecord[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isFile: false, children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    let pathSoFar = '';
    parts.forEach((part, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isFile = index === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: pathSoFar, isFile, children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

function TreeBranch({ node, onSelect, selectedPath }: { node: TreeNode; onSelect: (path: string) => void; selectedPath?: string }) {
  const entries = [...node.children.values()].sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1));
  return (
    <ul className="file-tree-branch">
      {entries.map((child) =>
        child.isFile ? (
          <li key={child.path}>
            <button className={child.path === selectedPath ? 'file-tree-item active' : 'file-tree-item'} onClick={() => onSelect(child.path)}>
              {child.name}
            </button>
          </li>
        ) : (
          <li key={child.path}>
            <details open>
              <summary>{child.name}/</summary>
              <TreeBranch node={child} onSelect={onSelect} selectedPath={selectedPath} />
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

// Read-only inspector for a project's generated output. Deliberately not an
// editor - the point is letting a learner see what the architecture became.
export function GeneratedFileTree({ projectId, files }: { projectId: string; files: GeneratedFileRecord[] }) {
  const [selectedPath, setSelectedPath] = useState<string>();
  const [contents, setContents] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function select(path: string) {
    setSelectedPath(path);
    setContents(undefined);
    setLoading(true);
    try {
      const file = await api.getProjectFile(projectId, path);
      setContents(file.contents);
    } catch (error) {
      setContents(error instanceof Error ? error.message : 'Failed to load file.');
    } finally {
      setLoading(false);
    }
  }

  const tree = buildTree(files);
  return (
    <div className="generated-file-browser">
      <div className="file-tree">
        <TreeBranch node={tree} onSelect={(path) => void select(path)} selectedPath={selectedPath} />
      </div>
      {selectedPath ? (
        <div className="file-preview-pane">
          <div className="file-preview-path">{selectedPath}</div>
          <pre className="yaml file-preview">{loading ? 'Loading…' : contents}</pre>
        </div>
      ) : (
        <div className="file-preview-pane muted">Select a file to preview it.</div>
      )}
    </div>
  );
}
