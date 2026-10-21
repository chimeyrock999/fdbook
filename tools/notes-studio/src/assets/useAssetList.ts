import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetInfo, AssetsClient } from '../api/assets';
import type { createFilesClient } from '../api/files';

const SETTLE_MS = 300;

// Every asset under public/notes with where it is used, while `enabled`
// (the Assets view is shown): loaded then, and reloaded when a note or an
// asset changes on disk. A burst of events (a rename touches many files,
// autosave keeps saving) settles into one reload; loads run one at a time,
// in order. While not enabled it keeps the last list and asks nothing.
export function useAssetList(client: AssetsClient, files: ReturnType<typeof createFilesClient>, enabled = true) {
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let queue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      queue = queue.then(async () => {
        try {
          const next = await client.listAssets();
          if (closed) return;
          setAssets(next);
          setError(null);
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    };
    reloadRef.current = load;
    const unsubscribe = files.subscribeFileEvents((event) => {
      if (event.path.endsWith('/meta.yaml')) return;
      clearTimeout(timer);
      timer = setTimeout(load, SETTLE_MS);
    });
    load();
    return () => {
      closed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, files, enabled]);

  const reload = useCallback(() => {
    reloadRef.current();
  }, []);
  return { assets, error, reload };
}
