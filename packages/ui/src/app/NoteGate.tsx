import { useEffect, useState, type ReactNode } from 'react';
import type { createFilesClient } from '#api/files.ts';

type Check = { path: string; error: string | null };

// Opens the editor only for a note the file API can read. The sync socket
// reports a refused or missing file only as a failed open, which the editor
// does not surface: it would show an empty, editable page.
export function NoteGate({ files, path, children }: {
  files: ReturnType<typeof createFilesClient>;
  path: string;
  children: ReactNode;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    let current = true;
    files.readFile(path).then(
      () => {
        if (current) setCheck({ path, error: null });
      },
      (reason: unknown) => {
        if (current) setCheck({ path, error: reason instanceof Error ? reason.message : String(reason) });
      },
    );
    return () => {
      current = false;
    };
  }, [files, path]);

  if (check?.path !== path) {
    return <p className="m-auto p-6 text-[13px] text-[var(--fde-muted-foreground)]">Opening…</p>;
  }
  if (check.error !== null) {
    return (
      <p role="alert" className="m-auto max-w-md p-6 text-[13px]">
        <span className="font-mono">{path}</span> cannot be opened: {check.error}. Pick a note from the list.
      </p>
    );
  }
  return children;
}
