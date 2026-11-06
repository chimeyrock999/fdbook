import { Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { PendingButton } from '#actions/PendingButton.tsx';
import { askAgent, useAsk } from '#agents/agent-ask.ts';
import { FieldError } from '#frontmatter/fields.tsx';
import { MetadataStrip, type FieldReveal } from '#frontmatter/MetadataStrip.tsx';
import type { Frontmatter } from '#frontmatter/useFrontmatter.ts';

// The frontmatter at the top of the note, where the note page shows it
// (app/notes/[[...slug]]/page.tsx): the title and description edited in
// place, and the other keys in a strip under them. `reveal` focuses the
// field at a frontmatter path; `onLeave` moves on into the body. The caller
// holds `frontmatter` (useFrontmatter) where it outlives Source mode, so the
// draft, and the `visible` it restores, survive a look at Source.
export function NoteHeader({ frontmatter, readOnly, onOpenSource, onLeave, reveal }: {
  frontmatter: Frontmatter;
  readOnly: boolean;
  onOpenSource: () => void;
  onLeave: () => void;
  reveal: FieldReveal | null;
}) {
  const title = useRef<HTMLTextAreaElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  // An author agent may fill the description, tags and keywords (#86): as
  // a suggestion, through the agent panel while it is open.
  const ask = useAsk();
  const canAsk = ask.can && !readOnly;

  // The strip handles every path but these two.
  useEffect(() => {
    if (reveal?.path === 'title') title.current?.focus();
    if (reveal?.path === 'description') description.current?.focus();
  }, [reveal]);

  if (frontmatter.status === 'invalid') {
    return (
      <div role="alert" className="studio-note-header grid gap-2 rounded-lg border border-[var(--fde-idea)] p-3 text-[12.5px]">
        <span>The frontmatter is not valid YAML: {frontmatter.error}</span>
        <button type="button" className="studio-button justify-self-start" onClick={onOpenSource}>
          Fix it in Source
        </button>
      </div>
    );
  }

  const { data, issueAt, set } = frontmatter;
  const titleError = issueAt('title');
  const descriptionError = issueAt('description');
  const stripReveal = reveal && reveal.path !== 'title' && reveal.path !== 'description' ? reveal : null;
  return (
    <header className="studio-note-header">
      {canAsk && (
        <PendingButton className="studio-note-fill" title="Ask the agent to fill the description, tags and keywords: it suggests them" pending={ask.pending === 'frontmatter'} disabled={ask.pending !== null} onClick={() => { askAgent('frontmatter'); }}>
          <Sparkles size={12} aria-hidden /> Fill
        </PendingButton>
      )}
      <Line
        ref={title}
        className="notes-title studio-note-title"
        label="Title"
        placeholder="Untitled"
        value={typeof data.title === 'string' ? data.title : ''}
        error={titleError}
        readOnly={readOnly}
        onChange={(value) => { set('title', value.replace(/\r?\n/g, ' ')); }}
        onKeyDown={(event) => { if (movesOn(event)) description.current?.focus(); }}
      />
      <FieldError message={titleError} />
      <Line
        ref={description}
        className="notes-description studio-note-description"
        label="Description"
        placeholder="Add a description"
        value={typeof data.description === 'string' ? data.description : ''}
        error={descriptionError}
        readOnly={readOnly}
        onChange={(value) => { set('description', value === '' ? undefined : value); }}
        onKeyDown={(event) => { if (movesOn(event)) onLeave(); }}
      />
      <FieldError message={descriptionError} />
      <MetadataStrip {...frontmatter} readOnly={readOnly} reveal={stripReveal} />
    </header>
  );
}

// Enter moves on; Shift+Enter breaks the line in the description. Not the
// Enter that commits an IME candidate: Safari ends the composition before
// that keydown, which then only shows as keyCode 229.
function movesOn(event: KeyboardEvent) {
  // keyCode is deprecated, but 229 is the only sign of that Enter in Safari.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const committing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  if (event.key !== 'Enter' || event.shiftKey || committing) return false;
  event.preventDefault();
  return true;
}

// A text area that grows with its text, styled as the line it stands for.
// It refits when the text changes and when its width does (a resize, the
// panels, fonts loading).
function Line({ ref, className, label, placeholder, value, error, readOnly, onChange, onKeyDown }: {
  ref: RefObject<HTMLTextAreaElement | null>;
  className: string;
  label: string;
  placeholder: string;
  value: string;
  error: string | undefined;
  readOnly: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  useLayoutEffect(() => {
    fit(ref.current);
  }, [ref, value]);
  useEffect(() => {
    const area = ref.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      fit(area);
    });
    observer.observe(area);
    void document.fonts.ready.then(() => { fit(area); });
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      aria-invalid={error !== undefined}
      data-field={label.toLowerCase()}
      className={`studio-note-line ${className}`}
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      onChange={(event) => { onChange(event.target.value); }}
      onKeyDown={onKeyDown}
    />
  );
}

function fit(area: HTMLTextAreaElement | null) {
  if (!area) return;
  area.style.height = 'auto';
  area.style.height = `${String(area.scrollHeight)}px`;
}
