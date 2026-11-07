import { MdxEditor } from '@fumadocs-editor/ui';
import { useMemo, useState } from 'react';
import { decorationsExtension } from '#features/editor/decorations.ts';
import { editorConfig, editorSyntax } from '#features/editor/plugins/index.ts';
import { diffNote, foldSame, type DiffItem, type FrontmatterChange } from './diff-blocks';

const extensions = [decorationsExtension(editorConfig.decorators)];

// A stretch of a note rendered as the editor shows it, read only.
export function NotePart({ source }: { source: string }) {
  return (
    <MdxEditor.Root defaultValue={source} components={editorConfig.components} syntax={editorConfig.syntax} extensions={extensions} editable={false}>
      <MdxEditor.Visual className="studio-prose notes-prose" />
    </MdxEditor.Root>
  );
}

const LABEL: Record<DiffItem['kind'], string> = { same: 'Unchanged', removed: 'Removed', added: 'Added', fold: 'Unchanged' };

function Item({ item }: { item: DiffItem }) {
  const [open, setOpen] = useState(false);
  if (item.kind === 'fold' && !open) {
    return (
      <button type="button" className="studio-diff-fold" onClick={() => { setOpen(true); }}>
        {item.blocks} unchanged {item.blocks === 1 ? 'block' : 'blocks'} · show
      </button>
    );
  }
  return (
    <section className="studio-diff-block" data-diff={item.kind === 'fold' ? 'same' : item.kind} aria-label={LABEL[item.kind]}>
      {/* The editor reads its text once: other text is another editor. */}
      <NotePart key={item.source} source={item.source} />
    </section>
  );
}

// A key for each item by what it holds, so a fold opened stays open, and
// only on itself, when the diff loads again; repeats count up.
function keyed(items: DiffItem[]) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.kind}:${item.source}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}:${String(count)}`, item };
  });
}

export function FrontmatterTable({ changes, added }: { changes: FrontmatterChange[]; added: boolean }) {
  if (changes.length === 0) return null;
  return (
    <table className="studio-diff-frontmatter">
      <caption>{added ? 'Frontmatter' : `Frontmatter · ${String(changes.length)} ${changes.length === 1 ? 'key' : 'keys'} changed`}</caption>
      <tbody>
        {changes.map((change) => (
          <tr key={change.key}>
            <th scope="row">{change.key}</th>
            <td>
              {change.before !== null && <del>{change.before}</del>}
              {change.after !== null && <ins>{change.after}</ins>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The rendered diff of a note: its frontmatter key by key, then its blocks
// as the editor renders them, removed ones over what replaced them, long
// unchanged stretches folded. `onUnparsed` hears that a side does not parse,
// so the page can show Source instead.
export function RenderedDiff({ before, after, onUnparsed }: { before: string | null; after: string | null; onUnparsed: () => void }) {
  const result = useMemo(() => diffNote(before ?? '', after ?? '', editorSyntax()), [before, after]);
  if (result === null) {
    return (
      <p role="alert" className="studio-diff-note">
        One side does not parse as MDX, so it cannot be rendered.{' '}
        <button type="button" className="studio-changes-link" onClick={onUnparsed}>Show Source</button>
      </p>
    );
  }
  return (
    <div className="studio-visual studio-diff-rendered">
      <FrontmatterTable changes={result.frontmatter} added={before === null} />
      {keyed(foldSame(result.body)).map(({ key, item }) => <Item key={key} item={item} />)}
    </div>
  );
}
