import { useCallback, useEffect, useRef, useState } from 'react';
import type { createFilesClient } from '#api/files.ts';
import type { TreeClient, TreeFolder } from '#api/tree.ts';
import { NOTES_DIR } from '@fdbook/shared/asset-types.ts';

const SETTLE_MS = 150;

// The page tree, reloaded when a note or a meta.yaml changes on disk, by
// the Studio or anything else. A burst of events (a rename touches many
// files) settles into one reload; loads run one at a time, in order.
// `reload` tells whether its load set a tree.
export function useTree(tree: TreeClient, files: ReturnType<typeof createFilesClient>) {
  const [root, setRoot] = useState<TreeFolder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  useEffect(() => {
    let closed = false;
    let queue = Promise.resolve(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      queue = queue.then(async () => {
        try {
          const next = await tree.loadTree();
          if (closed) return false;
          setRoot(next);
          setError(null);
          return true;
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
          return false;
        }
      });
      return queue;
    };
    reloadRef.current = load;
    const unsubscribe = files.subscribeFileEvents((event) => {
      if (!event.path.startsWith(`${NOTES_DIR}/`)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, SETTLE_MS);
    });
    void load();
    return () => {
      closed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [tree, files]);

  const reload = useCallback(() => reloadRef.current(), []);
  return { tree: root, error, reload };
}
