import { useEffect, useState } from 'react';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import type { CreateKind, TreeChange, TreeClient, TreeFolder, TreeNode, TreeRequest } from '#api/tree.ts';
import { Dialog } from '#components/Dialog.tsx';
import { slugify } from '@fdbook/shared/slug.ts';
import { renamedPath, slugOf } from './tree';
import { BASE_URL, type MetaName } from '@fdbook/shared/asset-types.ts';

const PREVIEW_MS = 200;

// What the server would write for `request`, asked again as it changes;
// `error` says why it would be refused.
function usePreview(client: TreeClient, request: TreeRequest | null) {
  const [preview, setPreview] = useState<{ changes: TreeChange[]; error: string | null } | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (request === null) return;
    let current = true;
    const timer = setTimeout(() => {
      client.change(request, true).then(
        (answer) => {
          if (current) setPreview({ changes: answer.changes, error: null });
        },
        (reason: unknown) => {
          if (current) setPreview({ changes: [], error: reason instanceof Error ? reason.message : String(reason) });
        },
      );
    }, PREVIEW_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `key` stands for `request`, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return request === null ? null : preview;
}

export function Changes({ changes }: { changes: TreeChange[] }) {
  return (
    <ul className="studio-tree-changes" aria-label="Files to write">
      {changes.map((change) => (
        <li key={`${change.type}:${change.path}`} data-change={change.type}>
          {change.type === 'add' && `+ ${change.path}`}
          {change.type === 'change' && (
            <>
              ~ {change.path} <span>{change.detail}</span>
            </>
          )}
          {change.type === 'move' && `${change.path} → ${change.to}`}
          {change.type === 'delete' && `− ${change.path}`}
          {change.type === 'keep' && (
            <>
              = {change.path} <span>{change.detail}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Preview({ preview }: { preview: ReturnType<typeof usePreview> }) {
  if (preview === null) return null;
  if (preview.error !== null) return <p role="alert" className="studio-tree-error">{preview.error}</p>;
  return (
    <div className="grid gap-1">
      <span className="studio-field-label">Writes</span>
      <Changes changes={preview.changes} />
    </div>
  );
}

const KINDS: { kind: CreateKind; label: string; file: (slug: string, meta: MetaName) => string; title: string }[] = [
  { kind: 'page', label: 'Page', file: (slug) => `${slug}.mdx`, title: 'New page in' },
  { kind: 'folder-page', label: 'Folder page', file: (slug) => `${slug}/index.mdx`, title: 'New folder page in' },
  { kind: 'plain-folder', label: 'Folder', file: (slug, meta) => `${slug}/${meta}`, title: 'New folder in' },
];

// A new page, folder page or plain folder in `parent`, after entry `after`.
// `onDone` gets the note to open, or the new folder's path when the new node
// is a plain folder. `metaName`: the meta file a new folder gets (the server
// decides; this only shows it).
export function CreateDialog({ client, parent, after, metaName = 'meta.json', onDone, onClose }: {
  client: TreeClient;
  parent: TreeFolder;
  after: number | null;
  metaName?: MetaName;
  onDone: (created: { open: string } | { folder: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [kind, setKind] = useState<CreateKind>('page');
  const [defaultOpen, setDefaultOpen] = useState(false);
  const action = useBusy();
  // Typed freely; what is saved is its slug form.
  const shownSlug = slug ?? slugify(title);
  const finalSlug = slugify(shownSlug);
  const request: TreeRequest | null =
    finalSlug === '' ? null : { op: 'create', parent: parent.path, slug: finalSlug, title, kind, defaultOpen: kind !== 'page' && defaultOpen, after };
  const preview = usePreview(client, request);

  // A failure says why in a toast; the dialog stays, to try again.
  const submit = () => {
    if (request === null || preview?.error != null) return;
    void action.run(async () => {
      const answer = await client.change(request);
      // A plain folder has no note to open: the server says where it is.
      onDone(answer.open === null ? { folder: answer.created ?? '' } : { open: answer.open });
    });
  };

  return (
    <Dialog title={`${KINDS.find((each) => each.kind === kind)?.title ?? 'New page in'} ${parent.title}`} busy={action.busy} onClose={onClose} onSubmit={submit}>
      <label className="grid gap-1">
        <span className="studio-field-label">Title</span>
        <input className="studio-input" autoFocus value={title} onChange={(event) => { setTitle(event.target.value); }} />
      </label>
      <label className="grid gap-1">
        <span className="studio-field-label">Slug</span>
        <input
          className="studio-input font-mono"
          value={shownSlug}
          onChange={(event) => { setSlug(event.target.value); }}
        />
      </label>
      <fieldset className="studio-tree-kinds">
        <legend className="studio-field-label">Kind</legend>
        {KINDS.map((each) => (
          <label key={each.kind}>
            <input type="radio" name="kind" checked={kind === each.kind} onChange={() => { setKind(each.kind); }} />
            {each.label} <small>{each.file(finalSlug || 'slug', metaName)}</small>
          </label>
        ))}
      </fieldset>
      {kind !== 'page' && (
        <label className="studio-tree-toggle">
          <input type="checkbox" checked={defaultOpen} onChange={(event) => { setDefaultOpen(event.target.checked); }} />
          <span>
            Open by default on the site
            <small>Writes <code>defaultOpen</code> in its {metaName}. Change it later from the folder’s ⋯ menu.</small>
          </span>
        </label>
      )}
      <Preview preview={preview} />
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={action.busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-primary" pending={action.busy} pendingLabel="Creating…" disabled={request === null || preview?.error != null}>Create</PendingButton>
      </div>
    </Dialog>
  );
}

// A new name for a page or folder, in the same folder.
export function RenameDialog({ client, node, unsaved, onDone, onClose }: {
  client: TreeClient;
  node: Extract<TreeNode, { kind: 'page' | 'folder' }>;
  // The open note while it has edits not on disk yet (see PageTree).
  unsaved: string | null;
  onDone: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(slugOf(node.path));
  const action = useBusy();
  const slug = slugify(typed);
  const changed = slug !== '' && slug !== slugOf(node.path);
  // Moving the file under the editor would drop its pending save.
  const waiting = unsaved !== null && renamedPath(unsaved, node.path, node.path) !== null;
  const request: TreeRequest | null = changed ? { op: 'rename', path: node.path, slug } : null;
  const preview = usePreview(client, request);
  const dir = node.path.includes('/') ? `${node.path.slice(0, node.path.lastIndexOf('/'))}/` : '';

  const submit = () => {
    if (request === null || waiting || preview?.error != null) return;
    void action.run(async () => {
      const answer = await client.change(request);
      const move = answer.changes.find((change) => change.type === 'move');
      onDone(node.path, move?.type === 'move' ? move.to : node.path);
    });
  };

  return (
    <Dialog title={`Rename “${node.title}”`} busy={action.busy} onClose={onClose} onSubmit={submit}>
      <div className="grid gap-1">
        <label className="grid gap-1">
          <span className="studio-field-label">{node.kind === 'folder' ? 'Folder name' : 'File name'}</span>
          <input
            className="studio-input font-mono"
            autoFocus
            value={typed}
            onChange={(event) => { setTyped(event.target.value); }}
          />
        </label>
        <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">
          URL: {BASE_URL}/{dir}{slug}. Change the title at the top of the note.
        </span>
      </div>
      <Preview preview={preview} />
      {waiting && <p role="status" className="studio-tree-error">The open note has unsaved changes. Rename once it shows Saved.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={action.busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-primary" pending={action.busy} pendingLabel="Renaming…" disabled={!changed || waiting || preview?.error != null}>Rename</PendingButton>
      </div>
    </Dialog>
  );
}
