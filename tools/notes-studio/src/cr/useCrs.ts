import { useCallback, useEffect, useRef, useState } from 'react';
import type { CrClient, CrList } from '../api/crs';
import type { createFilesClient } from '../api/files';

const SETTLE_MS = 1000;

// The change requests, loaded again when the window gets the focus back (a
// push or a merge made elsewhere) and, while `counting` (the list is shown),
// when files change in the open worktree, for its counts. Each load runs git
// in every worktree, so typing elsewhere does not trigger one. Loads run one
// at a time, in order; `reload(true)` reads the pull requests again too.
export function useCrs(client: CrClient, files: ReturnType<typeof createFilesClient>, counting: boolean) {
  const [list, setList] = useState<CrList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<(fresh?: boolean) => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    let closed = false;
    let queue = Promise.resolve();
    const load = (fresh = false) => {
      queue = queue.then(async () => {
        try {
          const next = await client.list(fresh);
          if (closed) return;
          setList(next);
          setError(null);
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
      return queue;
    };
    reloadRef.current = load;
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    void load();
    return () => {
      closed = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [client]);

  useEffect(() => {
    if (!counting) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = files.subscribeFileEvents(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { void reloadRef.current(); }, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [files, counting]);

  const reload = useCallback((fresh = false) => reloadRef.current(fresh), []);
  return { list, error, reload };
}
