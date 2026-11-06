import { useEffect, useState } from 'react';
import type { createFilesClient } from '#api/files.ts';
import { ASSETS_PREFIX } from './asset-names';

// The worktree paths of every asset under public/notes, sorted, kept in step
// with the disk through the file events (the Studio's own uploads too).
// Empty until the first list arrives; if it fails, the events alone keep
// it (the server still refuses a taken name).
export function useAssets(files: ReturnType<typeof createFilesClient>): readonly string[] {
  const [assets, setAssets] = useState<readonly string[]>([]);

  useEffect(() => {
    let closed = false;
    let listed: Set<string> | null = null;
    const pending: [string, boolean][] = [];
    const publish = (set: Set<string>) => {
      if (!closed) setAssets([...set].sort());
    };
    const unsubscribe = files.subscribeFileEvents((event) => {
      if (!event.path.startsWith(ASSETS_PREFIX)) return;
      const present = event.type !== 'unlink';
      if (listed === null) {
        pending.push([event.path, present]);
        return;
      }
      if (present) listed.add(event.path);
      else listed.delete(event.path);
      publish(listed);
    });
    // Events that arrived while listing apply after it, in order.
    const start = (paths: string[]) => {
      const set = new Set(paths);
      for (const [path, present] of pending) {
        if (present) set.add(path);
        else set.delete(path);
      }
      listed = set;
      publish(set);
    };
    files.listFiles().then(
      (entries) => { start(entries.filter((entry) => entry.kind === 'asset').map((entry) => entry.path)); },
      () => { start([]); },
    );
    return () => {
      closed = true;
      unsubscribe();
    };
  }, [files]);

  return assets;
}
