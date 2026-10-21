import { useCallback, useEffect, useRef, useState } from 'react';
import type { createFilesClient } from '../api/files';
import type { TreeClient, TreeFolder } from '../api/tree';

const SETTLE_MS = 150;

// The page tree, reloaded when a note or a meta.yaml changes on disk, by
// the Studio or anything else. A burst of events (a rename touches many
// files) settles into one reload; loads run one at a time, in order.
export function useTree(tree: TreeClient, files: ReturnType<typeof createFilesClient>) {
  const [root, setRoot] = useState<TreeFolder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let closed = false;
    let queue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      queue = queue.then(async () => {
        try {
          const next = await tree.loadTree();
          if (closed) return;
          setRoot(next);
          setError(null);
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    };
    reloadRef.current = load;
    const unsubscribe = files.subscribeFileEvents((event) => {
      if (!event.path.startsWith('content/notes/')) return;
      clearTimeout(timer);
      timer = setTimeout(load, SETTLE_MS);
    });
    load();
    return () => {
      closed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [tree, files]);

  const reload = useCallback(() => {
    reloadRef.current();
  }, []);
  return { tree: root, error, reload };
}
