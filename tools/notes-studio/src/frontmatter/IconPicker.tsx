import { createElement, useId, useState } from 'react';
import { iconOf, useNoteIcons } from './note-icons';

export function NoteIcon({ name, className }: { name: string; className?: string }) {
  const Icon = iconOf(useNoteIcons().icons, name);
  return Icon ? createElement(Icon, { 'aria-hidden': true, className }) : null;
}

const SHOWN = 120;

// A search over every lucide icon; picking one writes its name.
export function IconPicker({ value, onPick }: { value: string | undefined; onPick: (name: string) => void }) {
  const { icons, retry } = useNoteIcons();
  const [query, setQuery] = useState('');
  const id = useId();
  const names = typeof icons === 'object' && icons !== null ? icons.names : [];
  const needle = query.trim().toLowerCase();
  const found = names.filter((name) => name.toLowerCase().includes(needle));
  return (
    <div className="grid gap-2 rounded-[10px] border border-[var(--fde-border)] bg-[var(--fde-card)] p-2.5">
      <label htmlFor={id} className="sr-only">
        Search icons
      </label>
      <input
        id={id}
        type="search"
        autoFocus
        className="studio-input"
        placeholder={icons === 'failed' ? 'Could not load the icons' : icons ? `Search ${String(names.length)} lucide icons` : 'Loading icons…'}
        value={query}
        onChange={(event) => { setQuery(event.target.value); }}
      />
      {icons === 'failed' && (
        <button type="button" className="studio-link justify-self-start" onClick={retry}>
          Try again
        </button>
      )}
      <div role="listbox" aria-label="Icons" className="studio-icon-grid">
        {found.slice(0, SHOWN).map((name) => {
          const Icon = iconOf(icons, name);
          return (
            Icon && (
              <button
                key={name}
                type="button"
                role="option"
                title={name}
                aria-label={name}
                aria-selected={name === value}
                onClick={() => { onPick(name); }}
              >
                {createElement(Icon, { 'aria-hidden': true, className: 'size-[18px]' })}
              </button>
            )
          );
        })}
      </div>
      {names.length > 0 && (
        <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">
          {found.length > SHOWN ? `First ${String(SHOWN)} of ${String(found.length)}; type to narrow` : `${String(found.length)} icons`}
        </span>
      )}
    </div>
  );
}
