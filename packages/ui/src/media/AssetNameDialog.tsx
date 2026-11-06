import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NameRequest } from './asset-media';
import { composing } from '#lib/keyboard.ts';
import { slugify } from '@fdbook/shared/slug.ts';
import { sitePath } from './asset-names';
import { makeOthersInert, trapFocus } from '#components/dialog-focus.ts';

// Asks for the name of an image before it is saved: the suggested name comes
// selected so typing replaces it, the extension is fixed, and the path the
// note will get is shown as it is typed. A name already used in the page
// folder cannot be saved. `onDone` gets the stem, or null on Cancel/Escape.
// The rest of the page is inert while it is open: the editor inserts the
// image where the caret was at the paste, so the note must not change while
// the image waits for its name.
export function AssetNameDialog({ request, assets, onDone }: {
  request: Pick<NameRequest, 'dir' | 'stem' | 'extension'>;
  assets: readonly string[];
  onDone: (stem: string | null) => void;
}) {
  const [value, setValue] = useState(request.stem);
  const input = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return makeOthersInert(layer.current);
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

  return createPortal(
    <div
      ref={layer}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      // A click on the backdrop must not take the focus out of the form.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-name-title"
        className="grid w-full max-w-md gap-2 rounded-xl border border-[var(--fde-border)] bg-[var(--fde-background)] p-5 shadow-xl"
        onKeyDown={(event) => {
          // A key that ends an IME composition (Escape drops the marked
          // text, Enter commits it) neither cancels nor saves.
          if (composing(event)) {
            if (event.key === 'Enter') event.preventDefault();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone(null);
          }
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
    </div>,
    document.body,
  );
}
