import type { NotesPageFrontmatter } from '@fdbook/mdx/notes-schema.ts';
import { X } from 'lucide-react';
import { useId } from 'react';

type Graph = NonNullable<NotesPageFrontmatter['graph']>;
export type Keyword = NonNullable<Graph['keywords']>[number];

export function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="studio-field-error">{message}</span> : null;
}

// One labelled input. `field` is the frontmatter path it edits, so a lint
// issue on that path can focus it.
function Field({ label, value, onChange, error, field, mono = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  field: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-[3px]">
      <label htmlFor={id} className="text-[11.5px] text-[var(--fde-muted-foreground)]">
        {label}
      </label>
      <input
        id={id}
        type="text"
        data-field={field}
        aria-invalid={error !== undefined}
        className={`studio-input ${mono ? 'font-mono text-[12px]' : ''} ${error ? 'border-[var(--fde-error)]' : ''}`}
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
      />
      <FieldError message={error} />
    </div>
  );
}

// The id and displayName every graph entry has. `path` is the entry's own.
export function IdName({ value, path, issueAt, onChange }: {
  value: Keyword;
  path: string;
  issueAt: (path: string) => string | undefined;
  onChange: (value: Keyword) => void;
}) {
  return (
    <div className="studio-pair">
      <Field label="id" mono field={`${path}.id`} value={value.id} error={issueAt(`${path}.id`)} onChange={(id) => { onChange({ ...value, id }); }} />
      <Field
        label="displayName"
        field={`${path}.displayName`}
        value={value.displayName}
        error={issueAt(`${path}.displayName`)}
        onChange={(displayName) => { onChange({ ...value, displayName }); }}
      />
    </div>
  );
}

// Keywords as chips: a chip opens its id and displayName under the row,
// × removes it, + Keyword adds one and opens it. `path` is the list's.
export function KeywordChips({ keywords, path, issueAt, open, onOpen, onChange, readOnly }: {
  keywords: Keyword[];
  path: string;
  issueAt: (path: string) => string | undefined;
  open: number | null;
  onOpen: (index: number | null) => void;
  onChange: (keywords: Keyword[]) => void;
  readOnly: boolean;
}) {
  const hasIssue = (index: number) => issueAt(`${path}.${String(index)}.id`) ?? issueAt(`${path}.${String(index)}.displayName`);
  const editing = open === null ? undefined : keywords[open];
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword, index) => (
          <span
            key={index}
            className={`studio-chip ${hasIssue(index) ? 'studio-chip-bad' : ''}`}
            aria-current={open === index}
          >
            <button type="button" title={keyword.id} onClick={() => { onOpen(open === index ? null : index); }}>
              {keyword.displayName || 'Untitled'}
              <span className="studio-chip-id">{keyword.id}</span>
            </button>
            {!readOnly && (
              <button
                type="button"
                className="studio-chip-remove"
                aria-label={`Remove keyword ${keyword.displayName || String(index + 1)}`}
                onClick={() => {
                  onChange(keywords.filter((_, i) => i !== index));
                  onOpen(null);
                }}
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="studio-add rounded-full"
            onClick={() => {
              onChange([...keywords, { id: '', displayName: '' }]);
              onOpen(keywords.length);
            }}
          >
            + Keyword
          </button>
        )}
      </div>
      {editing && open !== null && (
        <div className="grid gap-1.5 rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-2">
          <IdName
            value={editing}
            path={`${path}.${String(open)}`}
            issueAt={issueAt}
            onChange={(next) => { onChange(keywords.map((k, i) => (i === open ? next : k))); }}
          />
          <button type="button" className="studio-link justify-self-end" onClick={() => { onOpen(null); }}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
