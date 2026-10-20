import { useEffect, useState } from 'react';
import type { createFilesClient } from '../api/files';
import { applyFileEvent, loadNotes, type NoteItem } from './notes';

// The note list, kept in step with the disk through the file events. Events
// that arrive while the list loads are applied after it, in order.
export function useNotes(files: ReturnType<typeof createFilesClient>) {
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    let latest: NoteItem[] | null = null;
    let queue = Promise.resolve();
    const update = (step: () => Promise<NoteItem[] | null>) => {
      queue = queue.then(async () => {
        try {
          const next = await step();
          if (closed) return;
          latest = next;
          setNotes(next);
        } catch (reason) {
          if (!closed) setError(String(reason));
        }
      });
    };
    const unsubscribe = files.subscribeFileEvents((event) => {
      update(() => (latest === null ? Promise.resolve(null) : applyFileEvent(files, latest, event)));
    });
    update(() => loadNotes(files));
    return () => {
      closed = true;
      unsubscribe();
    };
  }, [files]);

  return { notes, error };
}
