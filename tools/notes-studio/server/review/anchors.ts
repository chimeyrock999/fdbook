// Where a review thread sits on its note: one block, found again by its
// text and the blocks around it after the note changed. No Node imports:
// the editor places threads with these on the text being typed, and the
// server moves the stored anchor each time the note changes on disk
// (threads.ts), so edits one after another never lose it.

// `index` is where the block was (the frontmatter is block 0 when there is
// one, as in blocksOf); `before`/`after` the blocks next to it then, null at
// the start or end of the note; `seen` a hash of every block the note had
// then, copies too, so a block that was already there is never taken for
// this one edited.
export type Anchor = { index: number; text: string; before: string | null; after: string | null; seen: string[] };

type Texts = readonly { text: string }[];

// FNV-1a, 32 bits: short, and the same in Node and the browser.
export function hashOf(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// The anchor of block `index` of `blocks`.
export function anchorAt(blocks: Texts, index: number): Anchor {
  return {
    index,
    text: blocks[index].text,
    before: index > 0 ? blocks[index - 1].text : null,
    after: index + 1 < blocks.length ? blocks[index + 1].text : null,
    seen: blocks.map((block) => hashOf(block.text)),
  };
}

// How alike two blocks read, 0 to 1: the words they share (Dice), so
// a word changed in a paragraph leaves it close to 1.
function wordsOf(text: string) {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

export function likeness(a: string, b: string) {
  const [x, y] = [wordsOf(a), wordsOf(b)];
  let shared = 0;
  let total = 0;
  for (const count of x.values()) total += count;
  for (const [word, count] of y) {
    total += count;
    shared += Math.min(count, x.get(word) ?? 0);
  }
  return total === 0 ? (a.trim() === b.trim() ? 1 : 0) : (2 * shared) / total;
}

// A block edited in place, when nothing next to it says so: most of its
// words are still there. With one of its old neighbours next to it, less
// will do.
const ALIKE = 0.6;
const ALIKE_BESIDE = 0.4;

// The block of `blocks` that `anchor` names now, or null when it is gone:
// the same text, nearest where it was; else, among the blocks new since
// (one that was there all along is some other block), the one still
// between both its old neighbours, however much it changed, or the one
// most like it, enough to be the same block edited. When the text had
// copies and one fewer is left, the copy edited may be this one: the new
// block between its neighbours wins over the copies.
export function locate(anchor: Anchor, blocks: Texts): number | null {
  const nearest = (found: number[]) => found.reduce<number | null>((best, index) => (best === null || Math.abs(index - anchor.index) < Math.abs(best - anchor.index) ? index : best), null);
  const texts = blocks.map((block) => block.text);
  const copies = texts.flatMap((text, index) => (text === anchor.text ? [index] : []));
  const own = hashOf(anchor.text);
  if (copies.length > 0 && copies.length >= anchor.seen.filter((hash) => hash === own).length) return nearest(copies);
  const seen = new Set(anchor.seen);
  const fresh = texts.map((text) => !seen.has(hashOf(text)));
  const follows = (index: number) => (anchor.before === null ? index === 0 : index > 0 && texts[index - 1] === anchor.before);
  const precedes = (index: number) => (anchor.after === null ? index === texts.length - 1 : index + 1 < texts.length && texts[index + 1] === anchor.after);
  const between = nearest(texts.flatMap((_text, index) => (fresh[index] && follows(index) && precedes(index) ? [index] : [])));
  if (between !== null) return between;
  if (copies.length > 0) return nearest(copies);
  let best: { index: number; score: number } | null = null;
  texts.forEach((text, index) => {
    if (!fresh[index]) return;
    const score = likeness(anchor.text, text);
    if (score < (follows(index) || precedes(index) ? ALIKE_BESIDE : ALIKE)) return;
    if (best === null || score > best.score || (score === best.score && Math.abs(index - anchor.index) < Math.abs(best.index - anchor.index))) best = { index, score };
  });
  return (best as { index: number } | null)?.index ?? null;
}
