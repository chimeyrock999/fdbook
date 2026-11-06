import { listEditableFiles } from '#services/files/store.ts';
import { newMetaNameOf, type MetaName } from '@fdbook/shared/asset-types.ts';
import * as yaml from './meta-edit.ts';
import * as json from './meta-json.ts';

// A folder's meta file is a meta.json or a meta.yaml (fumadocs reads both).
// Each tree change edits the one the folder has through metaEditor, which
// picks the edits for its format; a folder that has none gets the format
// newMetaName says.

export type MetaEditor = {
  readPages: (text: string) => unknown[] | null;
  moveEntry: (text: string, from: number, to: number) => string;
  insertEntry: (text: string, value: string, at: number) => string | null;
  replaceEntry: (text: string, index: number, value: string) => string;
  keepEntries: (text: string, keep: (value: unknown) => boolean) => string;
  setFlag: (text: string, key: string, value: boolean) => string;
  removeKey: (text: string, key: string) => string;
  metaTemplate: (title: string, pages: string[], open?: boolean) => string;
  pagesTemplate: (pages: string[]) => string;
  hiddenTemplate: (pages: string[]) => string;
};

const YAML: MetaEditor = {
  ...yaml,
  hiddenTemplate: (pages) => `visible: false\n${yaml.pagesTemplate(pages)}`,
};

const JSON_EDITOR: MetaEditor = json;

// The edits for the meta file at `path` (a meta.json or a meta.yaml).
export const metaEditor = (path: string): MetaEditor => (path.endsWith('.json') ? JSON_EDITOR : YAML);

// The name of a meta file the Studio creates where a folder has none, as
// newMetaNameOf has it for the notes' meta files.
export async function newMetaName(root: string): Promise<MetaName> {
  return newMetaNameOf((await listEditableFiles(root)).filter((file) => file.kind === 'meta').map((file) => file.path));
}
