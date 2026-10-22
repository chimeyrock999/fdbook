import { useState } from 'react';

// Which element a popup menu (PopupMenu.tsx) is open under, if any.
export function useMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    toggle: (element: HTMLElement) => { setAnchor((open) => (open === null ? element : null)); },
    close: () => { setAnchor(null); },
  };
}
