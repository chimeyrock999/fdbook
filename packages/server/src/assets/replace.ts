import { HttpError } from '#http.ts';
import { ASSET_TYPES, extensionOf, isAssetExtension } from '@fdbook/shared/asset-types.ts';
import { checkAsset, planMove, scanNotes, usagesIn, type AssetPlan, type NoteScan } from './ops.ts';

export type ReplaceRequest = { path: unknown; extension: unknown; baseMtime: unknown };

const TYPES_LABEL = Object.keys(ASSET_TYPES).join(', ');

// New content for an asset, from a file with `extension`. With the asset's
// own extension only the file is written, so every note that uses it keeps
// working as it is. With another one the file takes that extension and
// every reference follows, as in a rename. The content itself comes with
// the apply (applyAssetPlan), so a dry run needs none.
export async function planAssetReplace(root: string, request: ReplaceRequest, scan: NoteScan = new Map()): Promise<AssetPlan> {
  const path = typeof request.path === 'string' ? request.path : '';
  const info = await checkAsset(root, path, request.baseMtime);
  const extension = typeof request.extension === 'string' ? request.extension.toLowerCase() : '';
  if (!isAssetExtension(extension)) {
    throw new HttpError(400, `the Studio does not store ${extension === '' ? 'files without an extension' : `.${extension} files`}: use ${TYPES_LABEL}`);
  }
  if (extension === extensionOf(path)) {
    const usages = usagesIn(await scanNotes(root, scan), [path]).get(path) ?? [];
    return { asset: { path, baseMtime: info.mtimeMs }, to: path, writes: [], changes: [{ type: 'replace', path, to: path }], usages };
  }
  const to = `${path.slice(0, path.lastIndexOf('.'))}.${extension}`;
  return planMove(root, { path, info }, to, scan, { type: 'replace', path, to });
}
