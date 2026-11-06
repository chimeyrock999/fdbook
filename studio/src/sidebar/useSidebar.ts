import { useCallback, useState } from 'react';

export type SidebarView = 'notes' | 'assets' | 'issues' | 'changes' | 'review';

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_WIDTH = 284;

const STORAGE_KEY = 'notes-studio:sidebar';

type Layout = { view: SidebarView; shown: boolean; width: number };

export const clampWidth = (width: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));

function readStored(): Layout {
  const fallback: Layout = { view: 'notes', shown: true, width: SIDEBAR_WIDTH };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<keyof Layout, unknown>>;
    return {
      view: value.view === 'issues' || value.view === 'assets' || value.view === 'changes' || value.view === 'review' ? value.view : 'notes',
      shown: value.shown !== false,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? clampWidth(value.width) : fallback.width,
    };
  } catch {
    return fallback;
  }
}

function store(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not kept across reloads; the sidebar still works.
  }
}

// The sidebar's view (Notes, Assets, Issues or Changes), whether it is shown and its width,
// kept in localStorage. Picking the view that is already open folds the
// sidebar, as VS Code's activity bar does.
export function useSidebar() {
  const [layout, setLayout] = useState(readStored);
  const update = useCallback((change: (current: Layout) => Layout) => {
    setLayout((current) => {
      const next = change(current);
      store(next);
      return next;
    });
  }, []);

  const pick = useCallback(
    (view: SidebarView) => {
      update((current) => (current.view === view && current.shown ? { ...current, shown: false } : { ...current, view, shown: true }));
    },
    [update],
  );
  // Switches the view and nothing else (the buttons in a phone's drawer).
  const select = useCallback((view: SidebarView) => { update((current) => ({ ...current, view })); }, [update]);
  // Opens `view` without ever folding the sidebar (the issues chip).
  const show = useCallback((view: SidebarView) => { update((current) => ({ ...current, view, shown: true })); }, [update]);
  const toggle = useCallback(() => { update((current) => ({ ...current, shown: !current.shown })); }, [update]);
  const resize = useCallback((width: number) => { update((current) => ({ ...current, width: clampWidth(width) })); }, [update]);
  return { ...layout, pick, select, show, toggle, resize };
}

export type Sidebar = ReturnType<typeof useSidebar>;
