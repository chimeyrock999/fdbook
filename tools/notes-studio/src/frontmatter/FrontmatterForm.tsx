import type { NotesPageFrontmatter } from '@site/lib/notes-schema';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  frontmatterText,
  readFrontmatter,
  writeFrontmatter,
  type FrontmatterData,
  type FrontmatterIssue,
} from './frontmatter';

type Graph = NonNullable<NotesPageFrontmatter['graph']>;
type Keyword = NonNullable<Graph['keywords']>[number];

// `yaml` is the block the draft belongs to. A written draft also keeps the
// block it replaced (`before`): see the effect below. `visible` is the key's
// value when the form first read this block, so turning the box off and on
// again restores it.
type Draft = {
  yaml: string | null;
  before: string | null;
  visible: unknown;
  data: FrontmatterData;
  issues: FrontmatterIssue[];
};

// The note's frontmatter as a form. Each change is checked against the shared
// schema and written into the note's source only when it passes; until then
// the form keeps the draft and shows the issues. A change to the source from
// elsewhere (source mode, the disk) resets the draft.
export function FrontmatterForm({
  source,
  onSource,
  readOnly,
  onOpenSource,
}: {
  source: string;
  onSource: (source: string) => void;
  readOnly: boolean;
  onOpenSource: () => void;
}) {
  const yaml = frontmatterText(source);
  // Typing in the body re-serializes the note; the frontmatter rarely changes.
  const read = useMemo(() => readFrontmatter(yaml === null ? '' : `---\n${yaml}\n---\n`), [yaml]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The editor parses source text after a short pause (300ms), and a visual
  // edit in that pause wins: the source comes back with the old block and the
  // body edit. Write the draft again on top of it rather than lose it. Only
  // for a moment after the write, so a later revert (Source, the disk) stays.
  const dropped = draft !== null && draft.before !== draft.yaml && yaml === draft.before;
  const current = draft?.yaml === yaml || dropped ? draft : null;
  if (draft !== null && current === null) setDraft(null);
  useEffect(() => {
    if (!dropped) return;
    const result = writeFrontmatter(source, draft.data);
    if (result.issues.length === 0) onSource(result.source);
  }, [dropped, draft, source, onSource]);
  useEffect(() => {
    if (draft === null || draft.before === draft.yaml) return;
    const settle = window.setTimeout(() => {
      setDraft((latest) => (latest === draft ? { ...draft, before: draft.yaml } : latest));
    }, RETRY_MS);
    return () => {
      window.clearTimeout(settle);
    };
  }, [draft]);

  if (read.status === 'invalid') {
    return (
      <Panel>
        <div role="alert" className="grid gap-2 rounded-lg border border-[var(--fde-idea)] p-3 text-[12.5px]">
          <span>The frontmatter is not valid YAML: {read.error}</span>
          <button type="button" className="studio-button justify-self-start" onClick={onOpenSource}>
            Fix it in Source
          </button>
        </div>
      </Panel>
    );
  }

  const data: FrontmatterData = current?.data ?? (read.status === 'ok' ? read.data : {});
  const issues = current?.issues ?? (read.status === 'ok' ? read.issues : []);
  const issueAt = (path: string) => issues.find((issue) => issue.path === path)?.message;
  // Issues no field shows, e.g. on keys the form does not edit.
  const unshown = issues.filter((issue) => !KNOWN.test(issue.path));
  const readVisible: unknown = current ? current.visible : read.status === 'ok' ? read.data.visible : undefined;

  const change = (next: FrontmatterData) => {
    const result = writeFrontmatter(source, next);
    if (result.issues.length === 0 && result.source !== source) onSource(result.source);
    setDraft({ yaml: frontmatterText(result.source), before: yaml, visible: readVisible, data: next, issues: result.issues });
  };
  const set = (key: string, value: unknown) => {
    change({ ...data, [key]: value });
  };
  const graph = data.graph;
  const setGraph = (next: Graph | undefined) => {
    set('graph', next);
  };

  return (
    <Panel>
      <fieldset disabled={readOnly} className="grid gap-3">
        <TextField label="Title" value={data.title ?? ''} error={issueAt('title')} onChange={(value) => { set('title', value); }} />
        <TextField
          label="Description"
          multiline
          value={data.description ?? ''}
          error={issueAt('description')}
          onChange={(value) => { set('description', value === '' ? undefined : value); }}
        />
        <label className="flex items-center justify-between gap-3">
          <span className="grid">
            <span className="text-[12.5px] font-medium">Shown on the site</span>
            <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">Off writes visible: false</span>
          </span>
          <input
            type="checkbox"
            checked={data.visible !== false}
            onChange={(event) => {
              set('visible', event.target.checked ? (readVisible === true ? true : undefined) : false);
            }}
          />
        </label>
        {issueAt('visible') && <FieldError message={issueAt('visible')} />}

        <div className="grid gap-2 rounded-lg border border-[var(--fde-border)] bg-[var(--fde-background)] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">Graph</span>
            {graph ? (
              <button type="button" className="studio-link" onClick={() => { setGraph(undefined); }}>
                Remove graph
              </button>
            ) : (
              <button
                type="button"
                className="studio-link"
                onClick={() => { setGraph({ id: slugify(data.title ?? ''), displayName: data.title ?? '' }); }}
              >
                Add graph
              </button>
            )}
          </div>
          {graph && (
            <>
              <IdName
                value={graph}
                errors={[issueAt('graph.id'), issueAt('graph.displayName')]}
                onChange={(value) => { setGraph({ ...graph, ...value }); }}
              />
              <KeywordList
                label="Keywords"
                keywords={graph.keywords ?? []}
                issueAt={(index, key) => issueAt(`graph.keywords.${String(index)}.${key}`)}
                onChange={(keywords) => { setGraph({ ...graph, keywords }); }}
              />
              <div className="grid gap-2">
                {(graph.sections ?? []).map((section, index) => {
                  const sections = graph.sections ?? [];
                  const at = (key: string) => issueAt(`graph.sections.${String(index)}.${key}`);
                  const replace = (next: Graph['sections']) => {
                    setGraph({ ...graph, sections: next });
                  };
                  return (
                    <div key={index} className="grid gap-2 border-t border-[var(--fde-border)] pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium">Section {index + 1}</span>
                        <button type="button" className="studio-link" onClick={() => { replace(sections.filter((_, i) => i !== index)); }}>
                          Remove
                        </button>
                      </div>
                      <IdName
                        value={section}
                        errors={[at('id'), at('displayName')]}
                        onChange={(value) => { replace(sections.map((s, i) => (i === index ? { ...s, ...value } : s))); }}
                      />
                      <KeywordList
                        label="Section keywords"
                        keywords={section.keywords ?? []}
                        issueAt={(k, key) => at(`keywords.${String(k)}.${key}`)}
                        onChange={(keywords) => { replace(sections.map((s, i) => (i === index ? { ...s, keywords } : s))); }
                        }
                      />
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="studio-add"
                  onClick={() => { setGraph({ ...graph, sections: [...(graph.sections ?? []), { id: '', displayName: '' }] }); }}
                >
                  + Section
                </button>
              </div>
            </>
          )}
        </div>
        {unshown.length > 0 && (
          <FieldError message={unshown.map((issue) => `${issue.path || 'frontmatter'}: ${issue.message}`).join('; ')} />
        )}
      </fieldset>
      <p className="text-[11.5px] text-[var(--fde-muted-foreground)]">
        Only the edited values change in the YAML; comments, key order and other keys stay.
      </p>
    </Panel>
  );
}

const RETRY_MS = 2000;

const KNOWN = /^(title|description|visible|graph\..+)$/;

function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Frontmatter" className="grid content-start gap-3">
      <h2 className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px] font-semibold">
        Frontmatter <span className="text-[11.5px] font-normal text-[var(--fde-muted-foreground)]">checked against notesPageSchema</span>
      </h2>
      {children}
    </section>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="text-[11.5px] text-[var(--fde-error)]">{message}</span> : null;
}

function TextField({
  label,
  value,
  onChange,
  error,
  multiline = false,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  multiline?: boolean;
  mono?: boolean;
}) {
  const id = useId();
  const className = `studio-input ${mono ? 'font-mono' : ''} ${error ? 'border-[var(--fde-error)]' : ''}`;
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="text-[12px] font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className={`${className} min-h-16 resize-y`} value={value} onChange={(event) => { onChange(event.target.value); }} />
      ) : (
        <input id={id} type="text" className={className} value={value} onChange={(event) => { onChange(event.target.value); }} />
      )}
      <FieldError message={error} />
    </div>
  );
}

function IdName({
  value,
  errors,
  onChange,
}: {
  value: Keyword;
  errors: [string | undefined, string | undefined];
  onChange: (value: Keyword) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <TextField label="id" mono value={value.id} error={errors[0]} onChange={(id) => { onChange({ ...value, id }); }} />
      <TextField
        label="displayName"
        value={value.displayName}
        error={errors[1]}
        onChange={(displayName) => { onChange({ ...value, displayName }); }}
      />
    </div>
  );
}

function KeywordList({
  label,
  keywords,
  issueAt,
  onChange,
}: {
  label: string;
  keywords: Keyword[];
  issueAt: (index: number, key: string) => string | undefined;
  onChange: (keywords: Keyword[]) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-medium">{label}</span>
      {keywords.map((keyword, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <IdName
              value={keyword}
              errors={[issueAt(index, 'id'), issueAt(index, 'displayName')]}
              onChange={(next) => { onChange(keywords.map((k, i) => (i === index ? next : k))); }}
            />
          </div>
          <button
            type="button"
            aria-label={`Remove keyword ${keyword.displayName || String(index + 1)}`}
            className="studio-link mt-6"
            onClick={() => { onChange(keywords.filter((_, i) => i !== index)); }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="studio-add" onClick={() => { onChange([...keywords, { id: '', displayName: '' }]); }}>
        + Keyword
      </button>
    </div>
  );
}
