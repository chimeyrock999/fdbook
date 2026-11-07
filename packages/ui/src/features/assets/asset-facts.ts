import { extensionOf } from '@fdbook/shared/asset-types.ts';
import { IMAGE_EXTENSIONS } from '#features/media/asset-names.ts';

// Whether the asset page and the sidebar show the file as a picture: an
// image type the site serves (asset-types.ts).
export const isImage = (path: string) => IMAGE_EXTENSIONS.includes(extensionOf(path));

// A file size as people read it: bytes, then KB and MB in steps of 1024.
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
