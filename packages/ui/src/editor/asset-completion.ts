import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { ASSETS_PREFIX, assetDirFor, sitePath } from '#media/asset-names.ts';
import { NOTES_PREFIX } from '#lib/note-paths.ts';

type AssetKind = 'html' | 'svg' | 'image' | 'any';

// Which assets an element shows: the embeds take one type, an image any image.
const KIND_OF: Partial<Record<string, AssetKind>> = {
  HtmlEmbed: 'html',
  html: 'html',
  SvgDiagram: 'svg',
  svg: 'svg',
  diagram: 'svg',
  img: 'image',
};
// Elements whose `src` is no public asset: a `<Diagram>` names a file under
// diagrams/ (components/mdx/diagram.tsx).
const NOT_ASSETS = new Set(['Diagram']);
const EXTENSIONS: Record<Exclude<AssetKind, 'any'>, RegExp> = {
  html: /\.html$/i,
  svg: /\.svg$/i,
  image: /\.(avif|gif|jpe?g|png|svg|webp)$/i,
};

// How far back to look for the element that owns a `src`.
const LOOK_BACK = 2000;

// The value being typed in `text` (the source up to the caret): a `src="…"`
// attribute of a JSX element or directive, or a Markdown image's `](…`.
// `from` is where the value starts; `kind` filters the assets.
export function assetContext(text: string): { from: number; kind: AssetKind } | null {
  const image = /!\[[^\]\n]*\]\(([^)\s]*)$/.exec(text);
  if (image) return { from: text.length - image[1].length, kind: 'image' };
  const src = /(?:^|[\s{])src=(["'])([^"'\n]*)$/.exec(text);
  if (!src) return null;
  // Up to and including the character before `src`, which may be a directive's `{`.
  const head = text.slice(0, src.index + 1);
  const owner = /<([A-Za-z][\w.]*)[^<>]*$/.exec(head)?.[1] ?? /::(\w+)\{[^{}]*$/.exec(head)?.[1];
  if (owner !== undefined && NOT_ASSETS.has(owner)) return null;
  return { from: text.length - src[2].length, kind: (owner === undefined ? undefined : KIND_OF[owner]) ?? 'any' };
}

// Completes asset paths under public/notes as the site writes them
// (`/notes/…`) while a `src` or an image link is typed. `assets` are
// worktree paths. The open page's own folder comes first, then the folder
// the note sits in, where many notes keep their assets.
export function assetCompletion(assets: readonly string[], notePath: string): CompletionSource {
  const here = `${assetDirFor(notePath)}/`;
  const near = `${ASSETS_PREFIX}${notePath.slice(NOTES_PREFIX.length, notePath.lastIndexOf('/') + 1)}`;
  const directlyIn = (path: string, dir: string) => path.startsWith(dir) && !path.slice(dir.length).includes('/');
  return (context: CompletionContext): CompletionResult | null => {
    const start = Math.max(0, context.pos - LOOK_BACK);
    const found = assetContext(context.state.sliceDoc(start, context.pos));
    if (!found) return null;
    const { kind } = found;
    const options: Completion[] = [];
    for (const path of assets) {
      if (kind !== 'any' && !EXTENSIONS[kind].test(path)) continue;
      if (directlyIn(path, here)) options.push({ label: sitePath(path), detail: 'this page', boost: 2 });
      else if (directlyIn(path, near)) options.push({ label: sitePath(path), detail: 'this folder', boost: 1 });
      else options.push({ label: sitePath(path) });
    }
    return { from: start + found.from, options, validFor: /^[^"'\s)]*$/ };
  };
}
