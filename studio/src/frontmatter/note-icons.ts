import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchIconNames } from '../api/icons';

export type Icons = { names: readonly string[]; known: ReadonlySet<string>; draw: Record<string, unknown> };

// The site turns `icon` into a lucide icon by name, from its own
// lucide-react; the server lists those names (lib/notes-icons.ts). The
// Studio draws them with its lucide-react, which still exports every name
// the site's has. Both are large, so they load on first use.
let loading: Promise<Icons> | null = null;
let loaded: Icons | null = null;

function loadIcons() {
  loading ??= Promise.all([fetchIconNames(), import('lucide-react')]).then(([names, studio]) => {
    return (loaded = { names, known: new Set(names), draw: studio });
  });
  // A failed load is tried again next time.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// Null until the sets have loaded, 'failed' if they could not; `retry`
// loads them again.
export function useNoteIcons(): { icons: Icons | 'failed' | null; retry: () => void } {
  const [icons, setIcons] = useState<Icons | 'failed' | null>(loaded);
  useEffect(() => {
    if (icons !== null) return;
    let live = true;
    loadIcons().then(
      (next) => {
        if (live) setIcons(next);
      },
      () => {
        if (live) setIcons('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [icons]);
  return {
    icons,
    retry: () => {
      setIcons(null);
    },
  };
}

export function iconOf(icons: Icons | 'failed' | null, name: string) {
  return typeof icons === 'object' && icons?.known.has(name) ? (icons.draw[name] as LucideIcon | undefined) : undefined;
}
