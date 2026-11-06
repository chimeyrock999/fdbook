import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useEffect, useRef } from 'react';

const LABELS: Record<DocumentStatus, string> = {
  synced: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Conflict',
  offline: 'Offline, edits kept in this tab',
  denied: 'Read-only: this note cannot be written',
};

const DOTS: Record<DocumentStatus, string> = {
  synced: 'bg-[var(--fde-success)]',
  dirty: 'bg-[var(--fde-idea)]',
  saving: 'bg-[var(--fde-idea)]',
  conflict: 'bg-[var(--fde-error)]',
  offline: 'bg-[var(--fde-error)]',
  denied: 'bg-[var(--fde-muted-foreground)]',
};

// The autosave state of the open note; null while it opens.
// `readOnly`: the note opened but cannot be written (main), so there is nothing to save.
export function SaveStatus({ status, readOnly = false }: { status: DocumentStatus | null; readOnly?: boolean }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--fde-muted-foreground)]">
      <span aria-hidden className={`size-2 rounded-full ${status && !readOnly ? DOTS[status] : 'bg-[var(--fde-muted-foreground)]'}`} />
      {readOnly ? 'Read only' : status ? LABELS[status] : 'Opening…'}
    </span>
  );
}

// Shown when the same block changed here and on disk (Obsidian, an agent).
// Changes to other blocks were already merged.
export function ConflictDialog({ onKeepMine, onTakeDisk }: { onKeepMine: () => void; onTakeDisk: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-body"
        className="grid w-full max-w-md gap-3 rounded-xl border border-[var(--fde-border)] bg-[var(--fde-background)] p-5 shadow-xl"
      >
        <h2 id="conflict-title" className="text-[15px] font-semibold">
          This note changed on disk
        </h2>
        <p id="conflict-body" className="text-[13px] text-[var(--fde-muted-foreground)]">
          A block you are editing was also changed somewhere else, for example in Obsidian or by an agent. Other changes were
          merged already. Choose which version of the note to keep.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="studio-button" onClick={onTakeDisk}>
            Take the disk version
          </button>
          <button ref={keep} type="button" className="studio-button studio-button-primary" onClick={onKeepMine}>
            Keep my version
          </button>
        </div>
      </div>
    </div>
  );
}
