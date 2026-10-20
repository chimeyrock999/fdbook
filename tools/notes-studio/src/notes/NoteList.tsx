import { useState } from 'react';
import { filterNotes, syncPath, type NoteItem } from './notes';

// A flat, filterable list of notes. The page tree that follows meta.yaml
// replaces it in #11.
export function NoteList({ notes, active, onSelect }: {
  notes: NoteItem[] | null;
  active: string | null;
  onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = notes === null ? [] : filterNotes(notes, query);
  return (
    <nav aria-label="Notes" className="flex min-h-0 flex-col gap-2 p-2.5">
      <input
        type="search"
        aria-label="Filter notes"
        placeholder="Filter by title or path"
        className="studio-input"
        value={query}
        onChange={(event) => { setQuery(event.target.value); }}
      />
      {notes === null ? (
        <p className="px-2 text-[12.5px] text-[var(--fde-muted-foreground)]">Loading notes…</p>
      ) : shown.length === 0 ? (
        <p className="px-2 text-[12.5px] text-[var(--fde-muted-foreground)]">No note matches “{query}”.</p>
      ) : (
        <ul className="grid min-h-0 gap-px overflow-auto">
          {shown.map((note) => (
            <li key={note.path}>
              <button
                type="button"
                aria-current={note.path === active ? 'page' : undefined}
                onClick={() => { onSelect(note.path); }}
                className="grid w-full rounded-md px-2 py-1 text-left hover:bg-[var(--fde-accent)] aria-[current=page]:bg-[var(--fde-accent)] aria-[current=page]:font-semibold"
              >
                <span className="truncate text-[13px]">{note.title}</span>
                <span className="truncate font-mono text-[11px] font-normal text-[var(--fde-muted-foreground)]">{syncPath(note.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
