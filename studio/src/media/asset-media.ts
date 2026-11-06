import type { MediaProvider } from '@fumadocs-editor/ui';
import { MAX_ASSET_BYTES } from '../../server/security/asset-types';
import { FileConflictError, publicAssetUrl, type createFilesClient } from '../api/files';
import { assetDirFor, IMAGE_TYPES_LABEL, imageExtension, sitePath, suggestedStem } from './asset-names';

// What the name dialog is asked: the image, its page folder (a worktree
// path), the suggested stem and the fixed extension.
export type NameRequest = { file: File; dir: string; stem: string; extension: string };
export type UploadNotice = { kind: 'busy' | 'error'; text: string };

// The person closed the name dialog: nothing was written, nothing to report.
export class UploadCancelled extends Error {
  constructor() {
    super('upload cancelled');
    this.name = 'UploadCancelled';
  }
}

// Where the editor's pasted, dropped and picked images go: the open note's
// folder under public/notes, under a name the person confirms (`askName`
// resolves the stem, or null to cancel). The note gets the site path
// (`/notes/…`), and site paths display through the file API. `notify` shows
// a notice; with `replacing`, only if that notice is still the one shown, so
// one upload never clears what another one reports.
export function createAssetMedia({ files, notePath, askName, notify, base = '' }: {
  files: ReturnType<typeof createFilesClient>;
  notePath: string;
  askName: (request: NameRequest) => Promise<string | null>;
  notify: (notice: UploadNotice | null, replacing?: UploadNotice) => void;
  base?: string;
}): MediaProvider {
  return {
    async upload(file) {
      const extension = imageExtension(file);
      if (extension === null) {
        const shown = file.name.includes('.') ? `.${file.name.slice(file.name.lastIndexOf('.') + 1)}` : file.type || 'this file';
        throw new Error(`${file.name}: the site cannot serve ${shown}. Use ${IMAGE_TYPES_LABEL}.`);
      }
      if (file.size > MAX_ASSET_BYTES) throw new Error(`${file.name} is larger than 25 MB, the most the Studio saves.`);
      const dir = assetDirFor(notePath);
      const stem = await askName({ file, dir, stem: suggestedStem(file.name), extension });
      if (stem === null) throw new UploadCancelled();
      const name = `${stem}.${extension}`;
      const busy: UploadNotice = { kind: 'busy', text: `Uploading ${name}…` };
      notify(busy);
      try {
        // A new file only: if the name was taken meanwhile the server refuses.
        await files.writeAsset(`${dir}/${name}`, file, null);
      } catch (error) {
        if (error instanceof FileConflictError) throw new Error(`${name} already exists on this page. Upload it again under another name.`, { cause: error });
        throw error;
      }
      notify(null, busy);
      return sitePath(`${dir}/${name}`);
    },
    resolve: (src) => publicAssetUrl(src, base) ?? src,
    onError(error) {
      if (error instanceof UploadCancelled) return;
      notify({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    },
  };
}
