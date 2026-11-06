import { notesPageSchema, type NotesPageFrontmatter } from '@fdbook/mdx/notes-schema.ts';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml';
import { findBlock } from '@fdbook/shared/frontmatter-block.ts';

// The YAML frontmatter of a note, read for the form and written back so that
// only the values that changed move: comments, key order, quoting and keys
// the form does not know (icon, …) stay as they were.

// Every key the block holds; the schema-known ones are typed.
export type FrontmatterData = Partial<NotesPageFrontmatter> & Record<string, unknown>;
export type FrontmatterIssue = { path: string; message: string };

export type FrontmatterRead =
  | { status: 'ok'; data: FrontmatterData; issues: FrontmatterIssue[] }
  | { status: 'missing' }
  | { status: 'invalid'; error: string };

// The YAML text of the block (without the `---` lines), or null if the note
// has none. Two sources with the same block hold the same frontmatter.
export function frontmatterText(source: string): string | null {
  return findBlock(source)?.yaml ?? null;
}

function parse(yaml: string): Document | null {
  const doc = parseDocument(yaml);
  return doc.errors.length > 0 ? null : doc;
}

export function validateFrontmatter(data: unknown): FrontmatterIssue[] {
  const result = notesPageSchema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function readFrontmatter(source: string): FrontmatterRead {
  const block = findBlock(source);
  if (!block) return { status: 'missing' };
  const doc = parseDocument(block.yaml);
  if (doc.errors.length > 0) return { status: 'invalid', error: doc.errors[0]?.message ?? 'Invalid YAML' };
  const value: unknown = doc.toJS() ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid', error: 'Frontmatter is not a mapping' };
  const data = value as FrontmatterData;
  return { status: 'ok', data, issues: validateFrontmatter(data) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Moves `node` to `value` in place where the shapes match, so untouched
// entries keep their comments and style; otherwise builds a new node.
function update(doc: Document, node: unknown, value: unknown): Node {
  if (isMap(node) && isRecord(value)) {
    // toJS turns every key into a string (`2024:` becomes "2024"), so match
    // pairs by their string form, not by the key node's own value.
    const keyOf = (pair: (typeof node.items)[number]) => String(isScalar(pair.key) ? pair.key.value : pair.key);
    node.items = node.items.filter((pair) => value[keyOf(pair)] !== undefined);
    for (const [key, next] of Object.entries(value)) {
      if (next === undefined) continue;
      const pair = node.items.find((item) => keyOf(item) === key);
      if (pair) pair.value = update(doc, pair.value, next);
      else node.items.push(doc.createPair(key, next));
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    // `keywords: []` that gains entries is written as a block list.
    if (node.flow && node.items.length === 0 && value.some(isRecord)) node.flow = false;
    node.items.splice(value.length);
    value.forEach((next, index) => {
      const current = node.items[index];
      node.items[index] = current === undefined ? doc.createNode(next) : update(doc, current, next);
    });
    return node;
  }
  if (isScalar(node) && !isRecord(value) && !Array.isArray(value)) {
    if (node.value !== value) node.value = value;
    return node;
  }
  return doc.createNode(value);
}

// Follows the block's own layout: its indent width, whether a list sits
// under its key or one level in, and no folding of long lines.
function stringifyOptions(yaml: string) {
  const lines = yaml.split(/\r?\n/);
  const indents = lines.map((line) => /^( +)\S/.exec(line)?.[1]?.length).filter((n) => n !== undefined);
  const indent = indents.length > 0 ? Math.min(...indents) : 2;
  const flatSeq = lines.some((line, index) => {
    const key = /^( *)[^\s#-][^:]*:\s*$/.exec(line);
    return key !== null && lines[index + 1]?.startsWith(`${key[1]}- `);
  });
  return { indent, indentSeq: !flatSeq, lineWidth: 0 };
}

// Writes `data` as the note's whole frontmatter. Nothing changes when it
// breaks the schema or the block does not parse; the issues say why.
export function writeFrontmatter(source: string, data: FrontmatterData): { source: string; issues: FrontmatterIssue[] } {
  const issues = validateFrontmatter(data);
  if (issues.length > 0) return { source, issues };

  const block = findBlock(source);
  const doc = block ? parse(block.yaml) : parseDocument('');
  if (!doc) return { source, issues: [{ path: '', message: 'The frontmatter is not valid YAML' }] };

  const options = stringifyOptions(block?.yaml ?? '');
  const before = doc.toString(options);
  doc.contents = update(doc, doc.contents, data);
  const after = doc.toString(options);
  if (block && after === before) return { source, issues };

  const newline = block?.newline ?? (source.includes('\r\n') ? '\r\n' : '\n');
  const yaml = after.replace(/\n$/, '').replace(/\n/g, newline);
  if (!block) return { source: `---${newline}${yaml}${newline}---${newline}${newline}${source}`, issues };
  return { source: `---${newline}${yaml}${newline}---${newline}${source.slice(block.end)}`, issues };
}

// The key path (`graph.keywords.1.id`) of the frontmatter value at `offset`
// in the note, as validateFrontmatter names paths; '' between keys (a
// comment, a blank line). Null outside the YAML text (the body, the `---`
// lines) and when it does not parse: Source shows those places better.
export function frontmatterPathAt(source: string, offset: number): string | null {
  const block = findBlock(source);
  // The YAML starts after `---` and its newline.
  const at = offset - 3 - (block?.newline.length ?? 0);
  if (!block || at < 0 || at > block.yaml.length) return null;
  const doc = parse(block.yaml);
  if (!doc) return null;
  const path: string[] = [];
  let node: unknown = doc.contents;
  const holds = (item: unknown) => {
    const range = (item as { range?: [number, number, number] } | null)?.range;
    return range !== undefined && at >= range[0] && at <= range[1];
  };
  for (;;) {
    if (isMap(node)) {
      const pair = node.items.find((item) => holds(item.key) || holds(item.value));
      if (!pair) break;
      path.push(String(isScalar(pair.key) ? pair.key.value : pair.key));
      node = pair.value;
    } else if (isSeq(node)) {
      const index = node.items.findIndex(holds);
      if (index === -1) break;
      path.push(String(index));
      node = node.items[index];
    } else break;
  }
  return path.join('.');
}
