import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MENU_WIDTH = 300;

// A menu under `anchor`, portalled to <body> like the Studio's other
// popups. Escape or a press outside closes it; a press on the anchor is left
// to the anchor, which toggles the menu.
export function PopupMenu({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const onEvent = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') close.current();
        return;
      }
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) close.current();
    };
    window.addEventListener('mousedown', onEvent);
    window.addEventListener('keydown', onEvent);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', onEvent);
      window.removeEventListener('keydown', onEvent);
    };
  }, [anchor]);
  const box = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.left, window.innerWidth - MENU_WIDTH - 8));
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="studio-menu studio-cr-menu" style={{ top: box.bottom + 4, left }}>
      {children}
    </div>,
    document.body,
  );
}
