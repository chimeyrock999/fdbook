import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangesClient, Changes, History } from '#api/changes.ts';
import type { createFilesClient } from '#api/files.ts';
import { EDITABLE_AREAS } from '@fdbook/shared/asset-types.ts';

const SETTLE_MS = 300;
const WATCHED = EDITABLE_AREAS.map((area) => `${area}/`);

// The worktree's changes and the change request's commits. The changes load
// again when a note, meta file, asset or diagram changes on disk; both load
// again when the window comes back (a commit made in a terminal) and on
// `reload` (after a commit), since a file event cannot add a commit. Loads
// run one at a time, in order; a burst of file events settles into one.
export function useChanges(client: ChangesClient, files: ReturnType<typeof createFilesClient>) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    let closed = false;
    let queue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (withHistory = true) => {
      queue = queue.then(async () => {
        try {
          const [nextChanges, nextHistory] = await Promise.all([client.loadChanges(), withHistory ? client.loadHistory() : null]);
          if (closed) return;
          setChanges(nextChanges);
          if (nextHistory !== null) setHistory(nextHistory);
          setError(null);
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
      return queue;
    };
    reloadRef.current = () => load();
    const unsubscribe = files.subscribeFileEvents((event) => {
      if (!WATCHED.some((prefix) => event.path.startsWith(prefix))) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void load(false); }, SETTLE_MS);
    });
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    void load();
    return () => {
      closed = true;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [client, files]);

  const reload = useCallback(() => reloadRef.current(), []);
  return { changes, history, error, reload };
}
