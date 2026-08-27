import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Renders its content through a portal into document.body, positioned via
// getBoundingClientRect() from the trigger button, rather than as an
// absolutely-positioned descendant of the toolbar. This is deliberate, not
// a convenience: the toolbar (.controls-panel) needs overflow-x: auto for
// narrow screens, and setting only overflow-x forces the *used* value of
// overflow-y to auto too (a real, if obscure, CSS quirk - see the CSS
// Overflow spec's "used value" rule for the non-'visible' longhand) - so
// any dropdown popover living inside it would get clipped vertically no
// matter what z-index it was given. Escaping to document.body sidesteps
// that entirely, and keeps this component reusable for any future toolbar
// popover, not just the resource-kind filter list.
export function PopoverDropdown({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updatePosition();

    const onOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div className="popover-anchor">
      <button type="button" ref={triggerRef} className={`popover-trigger${className ? ` ${className}` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
      {open && position && createPortal(
        <div ref={panelRef} className="popover-panel" style={{ top: position.top, right: position.right }}>
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
