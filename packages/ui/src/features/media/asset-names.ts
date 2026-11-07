import { ASSET_TYPES, ASSETS_DIR, extensionOf, siteUrlOf } from '@fdbook/shared/asset-types.ts';
import { NOTES_PREFIX } from '#lib/note-paths.ts';
import { slugify } from '@fdbook/shared/slug.ts';

export const ASSETS_PREFIX = `${ASSETS_DIR}/`;

// The image types the site serves, by extension and by MIME type. A pasted
// image often has no usable name, so its type picks the extension.
export const IMAGE_EXTENSIONS = Object.keys(ASSET_TYPES).filter((extension) => ASSET_TYPES[extension].startsWith('image/'));
const EXTENSION_OF_TYPE: Record<string, string> = { 'image/jpeg': 'jpg' };
for (const extension of IMAGE_EXTENSIONS) EXTENSION_OF_TYPE[ASSET_TYPES[extension]] ??= extension;

export const IMAGE_TYPES_LABEL = 'PNG, JPEG, WebP, GIF, AVIF or SVG';

// The folder a note's uploads go to: the page path under public/notes, where
// a folder's index page uses the folder. `notePath` and the result are
// worktree paths.
export function assetDirFor(notePath: string) {
  const parts = notePath.slice(NOTES_PREFIX.length).replace(/\.mdx$/, '').split('/');
  if (parts.at(-1) === 'index') parts.pop();
  return [ASSETS_DIR, ...parts].join('/');
}

// The path a note writes for an asset (`/docs/…`), from its worktree path.
export const sitePath = (assetPath: string) => siteUrlOf(assetPath);

// The name to offer for an upload: the file's own, else "image".
export function suggestedStem(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return slugify(dot === -1 ? fileName : fileName.slice(0, dot)) || 'image';
}

// The extension to save an image under, or null when the site cannot serve
// it: the name's own extension when it is an image type the site serves,
// else the one of the MIME type ("Screen Shot 10.21" is a PNG too).
export function imageExtension(file: { name: string; type: string }): string | null {
  const extension = extensionOf(file.name);
  if (IMAGE_EXTENSIONS.includes(extension)) return extension;
  return EXTENSION_OF_TYPE[file.type] ?? null;
}
