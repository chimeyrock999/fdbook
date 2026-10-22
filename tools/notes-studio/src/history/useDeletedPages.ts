import { useCallback, useEffect, useState } from 'react';
import type { DeletedPage, HistoryClient } from '../api/history';

// The pages deleted on HEAD, loaded again whenever `revision` changes (the
// commits loaded again) or `reload` is called (a restore).
export function useDeletedPages(client: HistoryClient, revision: unknown) {
  const [pages, setPages] = useState<DeletedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let closed = false;
    client.loadDeleted().then(
      (next) => {
        if (closed) return;
        setPages(next);
        setError(null);
      },
      (reason: unknown) => { if (!closed) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { closed = true; };
  }, [client, revision, reloads]);

  const reload = useCallback(() => { setReloads((count) => count + 1); }, []);
  return { pages, error, reload };
}
