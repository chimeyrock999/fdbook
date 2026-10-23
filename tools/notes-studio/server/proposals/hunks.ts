import { createSyntax, type SyntaxOptions } from '@fumadocs-editor/core';
import { align } from '../../src/diff/align.ts';
import { blockSpans } from '../../src/diff/block-spans.ts';
import { findBlock } from '../../src/frontmatter/block.ts';

// The dialects the editor parses notes with: what the plugins turn on
// (src/plugins, buildEditorConfig). The server cannot load the plugins (they
// are React), so a test keeps this equal to theirs. Only the dialects decide
// where a block starts and ends; the components do not.
export const NOTE_SYNTAX: SyntaxOptions = { directives: true };

const syntax = createSyntax([], NOTE_SYNTAX);

// One block of a note and where it sits in it. The frontmatter, with the
// newline after its closing `---`, is the first block when there is one;
// the body's top-level blocks follow, as the editor splits them.
export type Block = { text: string; start: number; end: number };

// The line (from 1) that the character at `offset` of `text` is on.
export const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

// Throws when the body does not parse.
export function blocksOf(source: string): Block[] {
  const front = findBlock(source);
  const offset = front?.end ?? 0;
  const blocks: Block[] = front === null ? [] : [{ text: source.slice(0, offset), start: 0, end: offset }];
  for (const span of blockSpans(source.slice(offset), syntax)) blocks.push({ text: span.text, start: offset + span.start, end: offset + span.end });
  return blocks;
}

// One change of a proposal: everything between two unchanged blocks (the
// anchors, null at the start or end of the note) in the note it was made
// against, `removed`, and what goes there instead, `added`. Both include the
// blank lines around the blocks they hold, so a change of spacing is a hunk
// too. `count` is how many blocks `removed` holds; `index` the block before
// it then (-1 at the start), to pick the nearest place when it repeats.
export type HunkText = { before: string | null; after: string | null; removed: string; added: string; count: number; index: number };

// The hunks that turn `base` into `next`, in order. Both must parse.
export function hunksOf(base: string, next: string): HunkText[] {
  const a = blocksOf(base);
  const b = blocksOf(next);
  const steps = align(a.map((block) => block.text), b.map((block) => block.text));
  const hunks: HunkText[] = [];
  // The last unchanged pair of blocks, -1 before the first.
  let [i, j, pi, pj] = [0, 0, -1, -1];
  const close = (ni: number, nj: number) => {
    const removed = base.slice(pi < 0 ? 0 : a[pi].end, ni < a.length ? a[ni].start : base.length);
    const added = next.slice(pj < 0 ? 0 : b[pj].end, nj < b.length ? b[nj].start : next.length);
    if (removed !== added) hunks.push({ before: pi < 0 ? null : a[pi].text, after: ni < a.length ? a[ni].text : null, removed, added, count: ni - pi - 1, index: pi });
  };
  for (const step of steps) {
    if (step === 'same') {
      close(i, j);
      [pi, pj] = [i, j];
      [i, j] = [i + 1, j + 1];
    } else if (step === 'removed') i += 1;
    else j += 1;
  }
  close(a.length, b.length);
  return hunks;
}

// Where a hunk's `removed` text is in `source`: [from, to), or null when
// it is no longer there (stale).
export type Place = { from: number; to: number };

type Span = Place & { k: number; anchors: number };

// The stretch after block `k` (-1: the start) up to block `m` (the length:
// the end), and how many of the hunk's anchors are there around it.
function spanOf(hunk: Pick<HunkText, 'before' | 'after'>, source: string, blocks: Block[], k: number, m: number): Span {
  const before = k < 0 ? hunk.before === null : blocks[k].text === hunk.before;
  const after = m >= blocks.length ? hunk.after === null : blocks[m].text === hunk.after;
  return { k, from: k < 0 ? 0 : blocks[k].end, to: m >= blocks.length ? source.length : blocks[m].start, anchors: Number(before) + Number(after) };
}

// The best of `spans`: the most anchors in place, then the nearest to where
// the hunk was.
const best = (spans: Span[], index: number) =>
  spans.reduce<Span | null>((top, span) => {
    if (top === null || span.anchors > top.anchors) return span;
    return span.anchors === top.anchors && Math.abs(span.k - index) < Math.abs(top.k - index) ? span : top;
  }, null);

// The hunk's place in `source` (split into `blocks`): a stretch of the same
// blocks with the same text, spacing included, as when it was made. Its
// neighbours may have changed since; when it repeats, the one with its
// anchors around it, then the nearest, wins. A hunk that holds no block
// (an insertion, a change of spacing) is placed by an anchor. Null when it
// is stale.
export function placeOf(hunk: HunkText, source: string, blocks: Block[]): Place | null {
  const spans: Span[] = [];
  for (let k = -1; k + hunk.count < blocks.length; k += 1) {
    const span = spanOf(hunk, source, blocks, k, k + hunk.count + 1);
    if ((hunk.count > 0 || span.anchors > 0) && source.slice(span.from, span.to) === hunk.removed) spans.push(span);
  }
  const found = best(spans, hunk.index);
  return found === null ? null : { from: found.from, to: found.to };
}

// A stale hunk set on what is now between its two anchors: the same change
// of that stretch, which then replaces whatever is there. Null when an
// anchor is gone too.
export function rebased(hunk: HunkText, source: string, blocks: Block[]): HunkText | null {
  const spans: Span[] = [];
  for (let k = -1; k < blocks.length; k += 1) {
    for (let m = k + 1; m <= blocks.length; m += 1) {
      const span = spanOf(hunk, source, blocks, k, m);
      if (span.anchors === 2) {
        spans.push(span);
        break;
      }
    }
  }
  const found = best(spans, hunk.index);
  if (found === null) return null;
  const count = blocks.filter((block) => block.start >= found.from && block.end <= found.to).length;
  return { ...hunk, removed: source.slice(found.from, found.to), count, index: found.k };
}

// `source` with each hunk's `added` at its place. The places must not overlap.
export function applyAt(source: string, edits: { place: Place; added: string }[]) {
  let result = source;
  for (const { place, added } of [...edits].sort((x, y) => y.place.from - x.place.from)) {
    result = result.slice(0, place.from) + added + result.slice(place.to);
  }
  return result;
}
