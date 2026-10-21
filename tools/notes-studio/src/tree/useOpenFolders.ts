import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreeFolder } from '../api/tree';
import { trailTo } from './tree';

const STORAGE_KEY = 'notes-studio:tree-open';

function readStored(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof value === 'object' && value !== null ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function store(value: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Not kept across reloads; the tree still works.
  }
}

// Which folders are open: the reader's own choice, kept in localStorage,
// else the folder's `defaultOpen`. The folders on the way to a note open
// when it becomes the open note, once, so the reader can still close them.
export function useOpenFolders(root: TreeFolder | null, active: string | null) {
  const [choices, setChoices] = useState(readStored);
  const revealed = useRef<string | null>(null);

  useEffect(() => {
    if (!root || active === null || revealed.current === active) return;
    const trail = trailTo(root, active);
    // A tree that does not hold the note yet (it was just created or
    // renamed) gets another try when it reloads.
    if (trail.length === 0) return;
    revealed.current = active;
    const folders = trail.filter((node): node is TreeFolder => node.kind === 'folder');
    setChoices((current) => {
      const closed = folders.filter((folder) => !(current[folder.id] ?? folder.defaultOpen));
      if (closed.length === 0) return current;
      const next = { ...current };
      for (const folder of closed) next[folder.id] = true;
      store(next);
      return next;
    });
  }, [root, active]);

  const isOpen = useCallback((folder: TreeFolder) => choices[folder.id] ?? folder.defaultOpen, [choices]);
  const toggle = useCallback((folder: TreeFolder) => {
    setChoices((current) => {
      const next = { ...current, [folder.id]: !(current[folder.id] ?? folder.defaultOpen) };
      store(next);
      return next;
    });
  }, []);
  const openFolder = useCallback((folder: TreeFolder) => {
    setChoices((current) => {
      const next = { ...current, [folder.id]: true };
      store(next);
      return next;
    });
  }, []);
  return { isOpen, toggle, openFolder };
}
