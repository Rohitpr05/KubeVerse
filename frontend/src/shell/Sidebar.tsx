export type ViewId = 'playground' | 'ai-builder' | 'architectures' | 'projects' | 'settings';

const workspaceItems: { id: ViewId; label: string }[] = [
  { id: 'playground', label: 'Playground' },
  { id: 'ai-builder', label: 'AI Builder' },
  { id: 'architectures', label: 'Architectures' },
  { id: 'projects', label: 'Projects' },
];

export function Sidebar({ active, onSelect }: { active: ViewId; onSelect: (view: ViewId) => void }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-section">
        <p className="sidebar-heading">Workspace</p>
        {workspaceItems.map((item) => (
          <button key={item.id} className={item.id === active ? 'sidebar-item active' : 'sidebar-item'} onClick={() => onSelect(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className={active === 'settings' ? 'sidebar-item active' : 'sidebar-item'} onClick={() => onSelect('settings')}>
          Settings
        </button>
      </div>
    </nav>
  );
}
