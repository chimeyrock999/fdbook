import { parse } from 'yaml';
import { MetaEditError, removeKey, setFlag } from './meta-edit.ts';

// `visible: false` written into, or taken out of, a page's frontmatter or a
// folder's meta.yaml, the key the site hides them by
// (lib/visible-page-tree.ts). Only that line changes: hiding and showing
// again gives back the file byte for byte.

// `---` on the first line, the YAML with its last newline, then `---`.
const BLOCK = /^---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;

// Hides (`visible` false) or shows the YAML text. Showing removes only a
// `visible: false`; any other value means the site shows it already.
function edit(yaml: string, visible: boolean, file: string) {
  if (!visible) return setFlag(yaml, 'visible', false, file);
  let data: unknown;
  try {
    data = parse(yaml);
  } catch (error) {
    throw new MetaEditError(`${file} does not parse: ${(error as Error).message}`);
  }
  const hidden = typeof data === 'object' && data !== null && (data as Record<string, unknown>).visible === false;
  return hidden ? removeKey(yaml, 'visible', file) : yaml;
}

// A meta.yaml left with no key at all would not pass the site's meta
// schema: it says `visible: true` instead (the Studio wrote it to hide a
// folder that had none).
export function writeMetaVisible(text: string, visible: boolean) {
  const next = edit(text, visible, 'meta.yaml');
  return next !== text && parse(next) === null ? setFlag(next, 'visible', true) : next;
}

export function writePageVisible(source: string, visible: boolean) {
  const block = BLOCK.exec(source);
  if (block?.index !== 0) throw new MetaEditError('the page has no frontmatter: add one first');
  const [, newline, yaml] = block as unknown as [string, string, string];
  const start = 3 + newline.length;
  const next = edit(yaml, visible, 'frontmatter');
  return next === yaml ? source : source.slice(0, start) + next + source.slice(start + yaml.length);
}
