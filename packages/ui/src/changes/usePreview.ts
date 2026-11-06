import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preview, PreviewClient } from '#api/preview.ts';

const POLL_MS = 5000;

const running = (preview: Preview | null) => preview?.build?.state === 'waiting' || preview?.build?.state === 'building';

// The worktree's preview: loaded at start, when the window gets the focus
// back (a push from a terminal) and on `reload` (after a commit), and every
// POLL_MS while Cloudflare has not finished the build. `set` takes the
// answer of a push, in line after any load already running, so an older
// answer never lands on top of it. Off (`enabled` false, as on main) it
// loads nothing.
export function usePreview(client: PreviewClient, enabled: boolean) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const setRef = useRef<(next: Preview) => void>(setPreview);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let queue = Promise.resolve();
    const load = () => {
      queue = queue.then(async () => {
        try {
          const next = await client.load();
          if (closed) return;
          setPreview(next);
          setError(null);
        } catch (reason) {
          if (!closed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
      return queue;
    };
    reloadRef.current = load;
    setRef.current = (next) => {
      queue = queue.then(() => {
        if (closed) return;
        setPreview(next);
        setError(null);
      });
    };
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    void load();
    return () => {
      closed = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [client, enabled]);

  const isRunning = running(preview);
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => { void reloadRef.current(); }, POLL_MS);
    return () => { clearInterval(timer); };
  }, [isRunning]);

  const reload = useCallback(() => reloadRef.current(), []);
  const set = useCallback((next: Preview) => { setRef.current(next); }, []);
  return { preview, error, reload, set };
}
