// The path policy: which files the Studio may touch, and what each one is.
// Published as `@fdbook/shared/asset-types.ts`, so it also passes on the
// asset types and the project's areas it is built from. No Node imports: the
// UI reads it too.
import { DIAGRAM_SUFFIX } from '@fdbook/diagram/source.ts';
import { ASSETS_DIR, DIAGRAMS_DIR, NOTES_DIR } from './areas.ts';
import { extensionOf, isAssetExtension } from './asset-types.ts';

export * from './areas.ts';
export * from './asset-types.ts';
export { DIAGRAM_SUFFIX };

export type PathKind = 'note' | 'meta' | 'asset' | 'diagram';

// Lexical check only: no `..`, `.`, empty or hidden segments (`.obsidian`,
// temp files), no backslashes or NUL, and a known name under a known area.
export function classifyPath(path: string): PathKind | null {
  if (path.includes('\\') || path.includes('\0')) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return null;
  const name = segments.at(-1) ?? '';
  const under = (dir: string) => path.startsWith(`${dir}/`);
  if (under(NOTES_DIR)) {
    if (name === 'meta.yaml') return 'meta';
    return name.endsWith('.mdx') ? 'note' : null;
  }
  if (under(ASSETS_DIR)) return isAssetExtension(extensionOf(name)) ? 'asset' : null;
  // Not diagrams/diagram.schema.json or any other file there.
  if (under(DIAGRAMS_DIR)) return name.endsWith(DIAGRAM_SUFFIX) ? 'diagram' : null;
  return null;
}

// Whether a file the Studio may touch is text: notes, meta.yaml, diagrams,
// and SVG and HTML assets. The diff (server/services/git/diff.ts) sends only the size of others.
export function isTextPath(path: string) {
  const kind = classifyPath(path);
  return kind !== null && (kind !== 'asset' || ['svg', 'html'].includes(extensionOf(path)));
}
