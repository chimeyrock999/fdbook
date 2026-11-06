import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { diffFrontmatter, diffNote, foldSame, type Run } from '../../../src/diff/diff-blocks';
import { editorSyntax } from '../../../src/plugins';

const read = (path: string) => readFileSync(join(repoRoot, 'content/notes', path), 'utf8');
const WATERMARK = read('streaming/watermark-and-late-events.mdx');

// The segments without their text: kind and block count.
const shape = (segments: Run[]) => segments.map((segment) => `${segment.kind}:${String(segment.blocks)}`);
const diff = (before: string, after: string) => {
  const result = diffNote(before, after, editorSyntax());
  if (result === null) throw new Error('did not parse');
  return result;
};

// Through the editor's real syntax, on real notes from content/notes.
describe('diffNote', () => {
  it('finds nothing changed in an unchanged note', () => {
    const { body, frontmatter } = diff(WATERMARK, WATERMARK);
    expect(body.every((segment) => segment.kind === 'same')).toBe(true);
    expect(frontmatter).toEqual([]);
  });

  it('marks an edited paragraph as removed then added, and nothing else', () => {
    const after = WATERMARK.replace('Nghe đơn giản:', 'Nghe có vẻ đơn giản:');
    const { body } = diff(WATERMARK, after);
    const changed = body.filter((segment) => segment.kind !== 'same');
    expect(shape(changed)).toEqual(['removed:1', 'added:1']);
    expect(changed[0].source).toContain('Nghe đơn giản:');
    expect(changed[1].source).toContain('Nghe có vẻ đơn giản:');
    // The rest is still there, in order, as it was.
    expect(body.map((segment) => (segment.kind === 'removed' ? '' : segment.source)).join('')).toContain('## Đặt vấn đề');
  });

  it('marks an inserted callout as added, and a removed accordion as removed', () => {
    const anchor = '## Hai khái niệm cần phân biệt trước\n';
    const inserted = WATERMARK.replace(anchor, `${anchor}\n:::tip\nTách event time và processing time trước.\n:::\n`);
    expect(shape(diff(WATERMARK, inserted).body.filter((segment) => segment.kind !== 'same'))).toEqual(['added:1']);
    const start = WATERMARK.indexOf('::::accordions');
    const removed = WATERMARK.slice(0, start).trimEnd() + '\n';
    const changed = diff(WATERMARK, removed).body.filter((segment) => segment.kind !== 'same');
    expect(shape(changed)).toEqual(['removed:1']);
    expect(changed[0].source).toContain(':::accordion{kind="question"');
  });

  it('keeps a removed run and an added run each as the source it came from', () => {
    // Two lists next to each other would join into one if their text were
    // glued together; each side's run is its own source instead.
    const before = '- one\n- two\n';
    const after = '- one\n- two\n- three\n';
    const { body } = diff(before, after);
    expect(body).toMatchObject([
      { kind: 'removed', blocks: 1, source: '- one\n- two' },
      { kind: 'added', blocks: 1, source: '- one\n- two\n- three' },
    ]);
  });

  it('shows two blocks swapped as one moved and the other kept', () => {
    const before = 'First.\n\nSecond.\n\nThird.\n';
    const after = 'Second.\n\nFirst.\n\nThird.\n';
    expect(shape(diff(before, after).body)).toEqual(['removed:1', 'same:1', 'added:1', 'same:1']);
  });

  it('leaves a block with graph markup alone when only another block changed', () => {
    const before = 'See :keyword[watermark]{id="watermark"} here.\n\nPlain.\n';
    const after = 'See :keyword[watermark]{id="watermark"} here.\n\nPlain, edited.\n';
    expect(shape(diff(before, after).body)).toEqual(['same:1', 'removed:1', 'added:1']);
  });

  it('answers null when a side does not parse', () => {
    expect(diffNote(WATERMARK, `${WATERMARK}\n<Broken\n`, editorSyntax())).toBeNull();
  });

  it('compares a note with nothing before it', () => {
    const { body, frontmatter } = diff('', WATERMARK);
    expect(body.every((segment) => segment.kind === 'added')).toBe(true);
    expect(frontmatter.find((row) => row.key === 'title')).toEqual({ key: 'title', before: null, after: 'Watermark and Late Events' });
  });
});

describe('diffFrontmatter', () => {
  it('lists the keys that changed, old and new', () => {
    const after = WATERMARK.replace('title: "Watermark and Late Events"', 'title: "Watermarks"').replace('  keywords: []\n', '  keywords: [lateness]\n');
    expect(diffFrontmatter(WATERMARK, after)).toEqual([
      { key: 'title', before: 'Watermark and Late Events', after: 'Watermarks' },
      { key: 'graph.keywords', before: '[]', after: '[ lateness ]' },
    ]);
  });

  it('lists added and removed keys', () => {
    expect(diffFrontmatter('---\ntitle: A\nicon: Book\n---\n', '---\ntitle: A\ndescription: B\n---\n')).toEqual([
      { key: 'icon', before: 'Book', after: null },
      { key: 'description', before: null, after: 'B' },
    ]);
  });

  it('shows YAML that does not parse as the text it is', () => {
    expect(diffFrontmatter('---\ntitle: A\n---\n', '---\ntitle: [A\n---\n')).toEqual([{ key: 'frontmatter', before: 'title: A', after: 'title: [A' }]);
  });
});

describe('foldSame', () => {
  const blocks = Array.from({ length: 10 }, (_, index) => `Block ${String(index)}.`);
  const note = blocks.join('\n\n');

  it('folds a long unchanged run, keeping one block of context at each end', () => {
    const after = `${note}\n\nNew.\n`;
    const items = foldSame(diff(note, after).body);
    expect(items.map((item) => `${item.kind}:${String(item.blocks)}`)).toEqual(['same:1', 'fold:8', 'same:1', 'added:1']);
    expect(items[0].source).toBe('Block 0.');
    // A fold opens onto the blocks it hides, as the note has them.
    expect(items[1].source).toBe(blocks.slice(1, 9).join('\n\n'));
    expect(items[2].source).toBe('Block 9.');
  });

  it('leaves a short unchanged run as it is', () => {
    const items = foldSame(diff('A.\n\nB.\n\nC.\n', 'A.\n\nB.\n\nC.\n\nD.\n').body);
    expect(items.map((item) => item.kind)).toEqual(['same', 'added']);
  });
});

describe('diffNote on a note rewritten through', () => {
  it('shows a middle too large to align as removed then added, at once', () => {
    const many = (word: string) => Array.from({ length: 1500 }, (_, index) => `${word} ${String(index)}.`).join('\n\n');
    const started = performance.now();
    const { body } = diff(`# Same\n\n${many('Old')}\n\nEnd.\n`, `# Same\n\n${many('New')}\n\nEnd.\n`);
    expect(shape(body)).toEqual(['same:1', 'removed:1500', 'added:1500', 'same:1']);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
