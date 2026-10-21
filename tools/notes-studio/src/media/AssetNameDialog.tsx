import { useEffect, useRef, useState } from 'react';
import type { NameRequest } from './asset-media';
import { slugify } from '../slug';
import { sitePath } from './asset-names';

// Asks for the name of an image before it is saved: the suggested name comes
// selected so typing replaces it, the extension is fixed, and the path the
// note will get is shown as it is typed. A name already used in the page
// folder cannot be saved. `onDone` gets the stem, or null on Cancel/Escape.
export function AssetNameDialog({ request, assets, onDone }: {
  request: Pick<NameRequest, 'dir' | 'stem' | 'extension'>;
  assets: readonly string[];
  onDone: (stem: string | null) => void;
}) {
  const [value, setValue] = useState(request.stem);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const stem = slugify(value);
  const path = `${request.dir}/${stem}.${request.extension}`;
  // The disk may not tell names apart by case.
  const taken = assets.some((asset) => asset.toLowerCase() === path.toLowerCase());
  const problem = stem === ''
    ? 'Type a name with letters or digits.'
    : taken
      ? `${stem}.${request.extension} already exists on this page. Pick another name.`
      : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-name-title"
        className="grid w-full max-w-md gap-2 rounded-xl border border-[var(--fde-border)] bg-[var(--fde-background)] p-5 shadow-xl"
        onKeyDown={(event) => {
          // Escape during an IME composition drops the marked text only.
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onDone(null);
          }
          // Focus stays in the dialog: the note must not change while the
          // image waits for its name, or it would land in the wrong place.
          if (event.key === 'Tab') trapFocus(event.currentTarget, event);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (problem === null) onDone(stem);
        }}
      >
        <h2 id="asset-name-title" className="text-[15px] font-semibold">
          Name this image
        </h2>
        <label htmlFor="asset-name" className="text-[12.5px] text-[var(--fde-muted-foreground)]">
          File name
        </label>
        <div className="flex items-center rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] px-2.5 focus-within:outline-2 focus-within:outline-[var(--fde-ring)]">
          <input
            ref={input}
            id="asset-name"
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => { setValue(event.target.value); }}
            className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-[13px] outline-none"
          />
          <span className="font-mono text-[13px] text-[var(--fde-muted-foreground)]">.{request.extension}</span>
        </div>
        <span data-testid="asset-path" className="font-mono text-[11.5px] break-all text-[var(--fde-muted-foreground)]">
          {sitePath(path)}
        </span>
        {problem !== null && (
          <span role="alert" className="text-[12.5px] text-[var(--fde-error)]">
            {problem}
          </span>
        )}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button type="button" className="studio-button" onClick={() => { onDone(null); }}>
            Cancel
          </button>
          <button type="submit" className="studio-button studio-button-primary disabled:opacity-50" disabled={problem !== null}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function trapFocus(dialog: HTMLElement, event: { shiftKey: boolean; preventDefault: () => void }) {
  const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
