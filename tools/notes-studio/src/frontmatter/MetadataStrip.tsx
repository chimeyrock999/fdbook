import type { NotesPageFrontmatter } from '@site/lib/notes-schema';
import { ChevronDown, Lock } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FieldError, IdName, KeywordChips } from './fields';
import type { FrontmatterData, FrontmatterIssue } from './frontmatter';
import { IconPicker, NoteIcon } from './IconPicker';
import { useNoteIcons } from './note-icons';

type Graph = NonNullable<NotesPageFrontmatter['graph']>;

// Keys a field edits; any other key is shown read-only.
const EDITED = new Set(['title', 'description', 'visible', 'graph', 'icon']);
// Issue paths a field shows next to itself.
const SHOWN = /^(title|description|visible|graph\..+)$/;

// Which keyword list has a chip open: the graph's or a section's.
type OpenChip = { list: 'graph' | number; index: number };

export type FieldReveal = { path: string; seq: number };

// Everything in the frontmatter but the title and description, under them:
// one summary line, and the fields once opened. `reveal` opens it on a path
// (a lint issue) and focuses that field.
export function MetadataStrip({ data, issues, issueAt, set, setVisible, readOnly, reveal }: {
  data: FrontmatterData;
  issues: FrontmatterIssue[];
  issueAt: (path: string) => string | undefined;
  set: (key: string, value: unknown) => void;
  setVisible: (shown: boolean) => void;
  readOnly: boolean;
  reveal: FieldReveal | null;
}) {
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<OpenChip | null>(null);
  const [picking, setPicking] = useState(false);
  const focused = useRef<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const { icons } = useNoteIcons();

  // A new reveal opens the strip (and the chip) on its path.
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal !== null) {
      setOpen(true);
      setChip(chipAt(reveal.path));
    }
  }
  // After the render that shows the field: the path's own, or else the first
  // field under its closest parent (`graph.keywords` has none: `graph.id`).
  useLayoutEffect(() => {
    if (reveal === null || !open || focused.current === reveal.seq) return;
    focused.current = reveal.seq;
    const path = reveal.path;
    for (let parts = path.split('.'); parts.length > 0; parts.pop()) {
      const at = CSS.escape(parts.join('.'));
      const target = strip.current?.querySelector<HTMLElement>(`[data-field="${at}"], [data-field^="${at}."]`);
      if (target) {
        target.focus();
        return;
      }
    }
    strip.current?.querySelector<HTMLElement>('button')?.focus();
  });

  const graph = data.graph;
  const setGraph = (next: Graph | undefined) => {
    set('graph', next);
  };
  const icon = typeof data.icon === 'string' ? data.icon : undefined;
  const iconError = icon !== undefined && typeof icons === 'object' && icons !== null && !icons.known.has(icon) ? `The site has no lucide icon named ${icon}.` : undefined;
  const others = Object.entries(data).filter(([key]) => !EDITED.has(key));
  const unshown = issues.filter((issue) => !SHOWN.test(issue.path));
  const keywordCount = graph?.keywords?.length ?? 0;
  const sectionCount = graph?.sections?.length ?? 0;
  const problems = issues.length + (iconError ? 1 : 0);

  return (
    <div ref={strip} className="studio-strip" data-open={open}>
      <button
        type="button"
        className="studio-strip-row"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setChip(null);
          setPicking(false);
        }}
      >
        {icon && (
          <span className="studio-badge" title={`icon: ${icon}`}>
            <NoteIcon name={icon} className="size-3.5" />
          </span>
        )}
        {readOnly && (
          <span className="studio-badge">
            <Lock aria-hidden className="size-3" /> Read-only
          </span>
        )}
        {data.visible === false && <span className="studio-badge studio-badge-warning">Hidden</span>}
        {graph ? (
          <>
            <span className="studio-badge font-mono text-[11.5px]">{graph.id}</span>
            <span>{plural(keywordCount, 'keyword')}</span>
            <span>· {plural(sectionCount, 'section')}</span>
          </>
        ) : (
          <span>No graph</span>
        )}
        {problems > 0 && <span className="studio-badge studio-badge-error">{plural(problems, 'error')}</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          {open ? 'Done' : 'Edit details'}
          <ChevronDown aria-hidden className="studio-strip-chevron size-3" />
        </span>
      </button>

      {open && (
        <fieldset disabled={readOnly} className="grid gap-3.5 px-0.5 pt-1 pb-3.5 text-[12.5px]">
          <Group title="Icon" action={icon && !readOnly ? <LinkButton onClick={() => { set('icon', undefined); setPicking(false); }}>Remove icon</LinkButton> : null}>
            <button
              type="button"
              data-field="icon"
              aria-expanded={picking}
              className={`studio-icon-current ${icon ? '' : 'studio-icon-none'}`}
              onClick={() => { setPicking(!picking); }}
            >
              {icon ? (
                <>
                  <NoteIcon name={icon} className="size-[18px]" />
                  <span className="font-mono text-[11.5px]">{icon}</span>
                </>
              ) : (
                'Choose an icon'
              )}
            </button>
            <FieldError message={iconError} />
            {picking && (
              <IconPicker
                value={icon}
                onPick={(name) => {
                  set('icon', name);
                  setPicking(false);
                }}
              />
            )}
          </Group>

          <div className="flex items-center justify-between gap-3">
            <span className="grid">
              <span>Shown on the site</span>
              <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">Off writes visible: false</span>
            </span>
            <button
              type="button"
              role="switch"
              data-field="visible"
              aria-label="Shown on the site"
              aria-checked={data.visible !== false}
              className="studio-switch"
              onClick={() => { setVisible(data.visible === false); }}
            />
          </div>
          <FieldError message={issueAt('visible')} />

          <Group
            title="Graph"
            action={
              graph ? (
                <LinkButton onClick={() => { setGraph(undefined); setChip(null); }}>Remove graph</LinkButton>
              ) : (
                <LinkButton
                  field="graph"
                  onClick={() => { setGraph({ id: slugify(data.title ?? ''), displayName: data.title ?? '' }); }}
                >
                  Add graph
                </LinkButton>
              )
            }
          >
            {graph && (
              <IdName value={graph} path="graph" issueAt={issueAt} onChange={(value) => { setGraph({ ...graph, ...value }); }} />
            )}
          </Group>

          {graph && (
            <>
              <Group title="Keywords">
                <KeywordChips
                  keywords={graph.keywords ?? []}
                  path="graph.keywords"
                  issueAt={issueAt}
                  open={chip?.list === 'graph' ? chip.index : null}
                  onOpen={(index) => { setChip(index === null ? null : { list: 'graph', index }); }}
                  onChange={(keywords) => { setGraph({ ...graph, keywords }); }}
                  readOnly={readOnly}
                />
              </Group>
              <Group title="Sections">
                {(graph.sections ?? []).map((section, index) => {
                  const sections = graph.sections ?? [];
                  const replace = (next: Graph['sections']) => {
                    setGraph({ ...graph, sections: next });
                  };
                  const path = `graph.sections.${String(index)}`;
                  return (
                    <div key={index} className="grid gap-2 rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{section.displayName || 'Untitled section'}</span>
                        {!readOnly && (
                          <LinkButton onClick={() => { replace(sections.filter((_, i) => i !== index)); setChip(null); }}>Remove</LinkButton>
                        )}
                      </div>
                      <IdName
                        value={section}
                        path={path}
                        issueAt={issueAt}
                        onChange={(value) => { replace(sections.map((s, i) => (i === index ? { ...s, ...value } : s))); }}
                      />
                      <KeywordChips
                        keywords={section.keywords ?? []}
                        path={`${path}.keywords`}
                        issueAt={issueAt}
                        open={chip?.list === index ? chip.index : null}
                        onOpen={(k) => { setChip(k === null ? null : { list: index, index: k }); }}
                        onChange={(keywords) => { replace(sections.map((s, i) => (i === index ? { ...s, keywords } : s))); }}
                        readOnly={readOnly}
                      />
                    </div>
                  );
                })}
                {!readOnly && (
                  <button
                    type="button"
                    className="studio-add"
                    onClick={() => { setGraph({ ...graph, sections: [...(graph.sections ?? []), { id: '', displayName: '' }] }); }}
                  >
                    + Section
                  </button>
                )}
              </Group>
            </>
          )}

          {others.length > 0 && (
            <Group title="Other keys">
              <dl className="grid gap-0.5 font-mono text-[11.5px] text-[var(--fde-muted-foreground)]">
                {others.map(([key, value]) => (
                  <div key={key} className="flex min-w-0 gap-1">
                    <dt>{key}:</dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            </Group>
          )}
          {unshown.length > 0 && (
            <FieldError message={unshown.map((issue) => `${issue.path || 'frontmatter'}: ${issue.message}`).join('; ')} />
          )}
          <span className="text-[11px] text-[var(--fde-muted-foreground)]">
            Only the edited values change in the YAML; comments, key order and other keys stay.
          </span>
        </fieldset>
      )}
    </div>
  );
}

// The open chip for a path inside a keyword list.
function chipAt(path: string): OpenChip | null {
  const graph = /^graph\.keywords\.(\d+)/.exec(path);
  if (graph) return { list: 'graph', index: Number(graph[1]) };
  const section = /^graph\.sections\.(\d+)\.keywords\.(\d+)/.exec(path);
  if (section) return { list: Number(section[1]), index: Number(section[2]) };
  return null;
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="studio-strip-label">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function LinkButton({ onClick, field, children }: { onClick: () => void; field?: string; children: ReactNode }) {
  return (
    <button type="button" className="studio-link" data-field={field} onClick={onClick}>
      {children}
    </button>
  );
}
