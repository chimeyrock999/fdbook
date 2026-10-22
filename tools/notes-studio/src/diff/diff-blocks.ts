import { parseMdxToDoc, type Syntax } from '@fumadocs-editor/core';
import { parseDocument, stringify } from 'yaml';
import { findBlock } from '../frontmatter/block';

// A run of top-level blocks, unchanged, removed (on main only) or added
// (in the change request only), as one stretch of the note it came from:
// `source` is that stretch, exactly, so it renders as it would there (two
// lists side by side stay two lists). `starts` and `ends` place each block
// in `source`, so a part of the run can be shown alone.
export type Run = { kind: 'same' | 'removed' | 'added'; blocks: number; source: string; starts: number[]; ends: number[] };
// A frontmatter key that changed: its dotted path, and the value before and
// after as text, null where the key is missing.
export type FrontmatterChange = { key: string; before: string | null; after: string | null };
// What the diff view shows: runs, with long unchanged stretches folded.
export type DiffItem = { kind: Run['kind'] | 'fold'; blocks: number; source: string };

type Blocks = { body: string; sources: string[]; starts: number[]; ends: number[] };

// The note after its frontmatter, as top-level blocks: their text and where
// each sits in the body. Throws when the note does not parse.
function blocksOf(source: string, syntax: Syntax): Blocks {
  const body = source.slice(findBlock(source)?.end ?? 0);
  const { snapshot } = parseMdxToDoc(body, syntax);
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = snapshot.leading.length;
  snapshot.blocks.forEach((block, index) => {
    starts.push(offset);
    ends.push(offset + block.source.length);
    offset += block.source.length + (snapshot.gaps[index]?.length ?? 0);
  });
  return { body, sources: snapshot.blocks.map((block) => block.source), starts, ends };
}

// Blocks `from` to `to` (exclusive) of one side, as a run.
function runOf(kind: Run['kind'], side: Blocks, from: number, to: number): Run {
  const start = side.starts[from];
  return {
    kind,
    blocks: to - from,
    source: side.body.slice(start, side.ends[to - 1]),
    starts: side.starts.slice(from, to).map((offset) => offset - start),
    ends: side.ends.slice(from, to).map((offset) => offset - start),
  };
}

// The most cells the alignment table may have (a million: under 10 MB, a
// few milliseconds). A middle larger than that, a note rewritten through,
// shows as all removed then all added rather than hold up the page.
const MAX_CELLS = 1_000_000;

// Which blocks of `a` and `b` are the same, by exact text: a longest common
// subsequence, after the common start and end are taken off. On a tie a
// block of `a` goes first, so an edit shows as removed then added.
function align(a: string[], b: string[]): ('same' | 'removed' | 'added')[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const same = (count: number) => new Array<'same'>(count).fill('same');
  if (x.length * y.length > MAX_CELLS) {
    return [...same(head), ...new Array<'removed'>(x.length).fill('removed'), ...new Array<'added'>(y.length).fill('added'), ...same(tail)];
  }
  // lengths[i][j]: the longest common subsequence of x[i..] and y[j..].
  const lengths = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = x[i] === y[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const steps: ('same' | 'removed' | 'added')[] = same(head);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      steps.push('same');
      i += 1;
      j += 1;
    } else if (j >= y.length || (i < x.length && lengths[i + 1][j] >= lengths[i][j + 1])) {
      steps.push('removed');
      i += 1;
    } else {
      steps.push('added');
      j += 1;
    }
  }
  return steps.concat(same(tail));
}

// The note's body on main (`before`) against the change request (`after`),
// block by block, and its frontmatter key by key; null when a side does not
// parse. Between two unchanged blocks, what main had comes first as one
// removed run, then what replaced it as one added run. Unchanged runs carry
// the change request's text.
export function diffNote(before: string, after: string, syntax: Syntax): { body: Run[]; frontmatter: FrontmatterChange[] } | null {
  let a: Blocks;
  let b: Blocks;
  try {
    a = blocksOf(before, syntax);
    b = blocksOf(after, syntax);
  } catch {
    return null;
  }
  const steps = align(a.sources, b.sources);
  const body: Run[] = [];
  // i and j: the next block of each side; each pass takes one unchanged run
  // or one hunk of changes.
  let i = 0;
  let j = 0;
  for (let step = 0; step < steps.length;) {
    const at = { i, j };
    if (steps[step] === 'same') {
      while (steps[step] === 'same') [step, i, j] = [step + 1, i + 1, j + 1];
      body.push(runOf('same', b, at.j, j));
      continue;
    }
    for (; step < steps.length && steps[step] !== 'same'; step += 1) {
      if (steps[step] === 'removed') i += 1;
      else j += 1;
    }
    if (i > at.i) body.push(runOf('removed', a, at.i, i));
    if (j > at.j) body.push(runOf('added', b, at.j, j));
  }
  return { body, frontmatter: diffFrontmatter(before, after) };
}

// A value as one line of YAML: strings as they are, lists and maps in flow style.
function show(value: unknown) {
  if (typeof value === 'string') return value;
  return stringify(value, { collectionStyle: 'flow' }).trim();
}

// Leaf values by dotted path: nested maps are walked, lists are one value.
function flatten(value: unknown, prefix: string, into: Map<string, string>) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix === '' ? key : `${prefix}.${key}`, into);
  } else if (prefix !== '') into.set(prefix, show(value));
  return into;
}

// The frontmatter as values by path, null without one, or the YAML text
// when it does not parse into a mapping.
function readValues(source: string): Map<string, string> | string | null {
  const block = findBlock(source);
  if (block === null) return null;
  const doc = parseDocument(block.yaml);
  const value: unknown = doc.errors.length > 0 ? null : (doc.toJS() ?? {});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return block.yaml;
  return flatten(value, '', new Map());
}

// The frontmatter keys that differ, in main's order, then keys only the
// change request has. YAML that does not parse shows as one row of text.
export function diffFrontmatter(before: string, after: string): FrontmatterChange[] {
  const a = readValues(before);
  const b = readValues(after);
  if (typeof a === 'string' || typeof b === 'string') {
    const was = findBlock(before)?.yaml ?? null;
    const now = findBlock(after)?.yaml ?? null;
    return was === now ? [] : [{ key: 'frontmatter', before: was, after: now }];
  }
  const was = a ?? new Map<string, string>();
  const now = b ?? new Map<string, string>();
  const keys = [...was.keys(), ...[...now.keys()].filter((key) => !was.has(key))];
  return keys
    .filter((key) => was.get(key) !== now.get(key))
    .map((key) => ({ key, before: was.get(key) ?? null, after: now.get(key) ?? null }));
}

// The runs as shown: an unchanged run longer than `context` blocks at each
// end plus one folds its middle, which opens onto the blocks it hides.
export function foldSame(runs: Run[], context = 1): DiffItem[] {
  return runs.flatMap((run): DiffItem[] => {
    if (run.kind !== 'same' || run.blocks <= context * 2 + 1) return [{ kind: run.kind, blocks: run.blocks, source: run.source }];
    const part = (from: number, to: number) => run.source.slice(run.starts[from], run.ends[to - 1]);
    const last = run.blocks - context;
    return [
      { kind: 'same', blocks: context, source: part(0, context) },
      { kind: 'fold', blocks: last - context, source: part(context, last) },
      { kind: 'same', blocks: context, source: part(last, run.blocks) },
    ];
  });
}
