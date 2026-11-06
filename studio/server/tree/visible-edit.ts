import { parse } from 'yaml';
import { findBlock } from '../../src/frontmatter/block.ts';
import { MetaEditError, removeKey, setFlag } from './meta-edit.ts';

// `visible: false` written into, or taken out of, a page's frontmatter or a
// folder's meta.yaml, the key the site hides them by
// (lib/visible-page-tree.ts). Only that line changes: hiding and showing
// again gives back the file byte for byte, unless it said `visible: true`.

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
// schema: it says `visible: true` instead.
export function writeMetaVisible(text: string, visible: boolean) {
  const next = edit(text, visible, 'meta.yaml');
  return next !== text && parse(next) === null ? setFlag(next, 'visible', true) : next;
}

export function writePageVisible(source: string, visible: boolean) {
  const block = findBlock(source);
  if (!block) throw new MetaEditError('the page has no frontmatter: add one first');
  // The YAML with the newline before the closing `---`, so a line added at
  // its end ends like the others.
  const start = 3 + block.newline.length;
  const close = source.lastIndexOf('---', block.end - 1);
  const yaml = source.slice(start, close);
  const next = edit(yaml, visible, 'frontmatter');
  return next === yaml ? source : source.slice(0, start) + next + source.slice(close);
}
