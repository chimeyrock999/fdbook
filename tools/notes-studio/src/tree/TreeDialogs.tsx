import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CreateKind, TreeChange, TreeClient, TreeFolder, TreeNode, TreeRequest } from '../api/tree';
import { makeOthersInert, trapFocus } from '../dialog-focus';
import { slugify } from '../slug';
import { renamedPath, slugOf } from './tree';

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

function Changes({ changes }: { changes: TreeChange[] }) {
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

// A modal over the whole Studio: the rest of the page is inert while it is
// open, so the note behind it cannot change, and Tab stays inside. The
// asset dialogs use it too.
export function Dialog({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => makeOthersInert(layer.current), []);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return createPortal(
    <div ref={layer} className="studio-dialog-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="studio-dialog"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Tab') trapFocus(event.currentTarget, event);
        }}
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
      </form>
    </div>,
    document.body,
  );
}

function Preview({ preview, failed }: { preview: ReturnType<typeof usePreview>; failed: string | null }) {
  if (failed !== null) return <p role="alert" className="studio-tree-error">{failed}</p>;
  if (preview === null) return null;
  if (preview.error !== null) return <p role="alert" className="studio-tree-error">{preview.error}</p>;
  return (
    <div className="grid gap-1">
      <span className="studio-field-label">Writes</span>
      <Changes changes={preview.changes} />
    </div>
  );
}

const KINDS: { kind: CreateKind; label: string; file: (slug: string) => string; title: string }[] = [
  { kind: 'page', label: 'Page', file: (slug) => `${slug}.mdx`, title: 'New page in' },
  { kind: 'folder-page', label: 'Folder page', file: (slug) => `${slug}/index.mdx`, title: 'New folder page in' },
  { kind: 'folder', label: 'Folder', file: (slug) => `${slug}/meta.yaml`, title: 'New folder in' },
];

// A new page, folder page or plain folder in `parent`, after entry `after`.
// `onDone` gets the note to open, or the new folder's path when the new node
// is a plain folder.
export function CreateDialog({ client, parent, after, onDone, onClose }: {
  client: TreeClient;
  parent: TreeFolder;
  after: number | null;
  onDone: (created: { open: string } | { folder: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [kind, setKind] = useState<CreateKind>('page');
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Typed freely; what is saved is its slug form.
  const shownSlug = slug ?? slugify(title);
  const finalSlug = slugify(shownSlug);
  const request: TreeRequest | null =
    finalSlug === '' ? null : { op: 'create', parent: parent.path, slug: finalSlug, title, kind, defaultOpen: kind !== 'page' && defaultOpen, after };
  const preview = usePreview(client, request);

  const submit = () => {
    if (request === null) return;
    client.change(request).then(
      (answer) => { onDone(answer.open === null ? { folder: parent.path === '' ? finalSlug : `${parent.path}/${finalSlug}` } : { open: answer.open }); },
      (reason: unknown) => { setFailed(reason instanceof Error ? reason.message : String(reason)); },
    );
  };

  return (
    <Dialog title={`${KINDS.find((each) => each.kind === kind)?.title ?? 'New page in'} ${parent.title}`} onClose={onClose} onSubmit={submit}>
      <label className="grid gap-1">
        <span className="studio-field-label">Title</span>
        <input className="studio-input" autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setFailed(null); }} />
      </label>
      <label className="grid gap-1">
        <span className="studio-field-label">Slug</span>
        <input
          className="studio-input font-mono"
          value={shownSlug}
          onChange={(event) => { setSlug(event.target.value); setFailed(null); }}
        />
      </label>
      <fieldset className="studio-tree-kinds">
        <legend className="studio-field-label">Kind</legend>
        {KINDS.map((each) => (
          <label key={each.kind}>
            <input type="radio" name="kind" checked={kind === each.kind} onChange={() => { setKind(each.kind); setFailed(null); }} />
            {each.label} <small>{each.file(finalSlug || 'slug')}</small>
          </label>
        ))}
      </fieldset>
      {kind !== 'page' && (
        <label className="studio-tree-toggle">
          <input type="checkbox" checked={defaultOpen} onChange={(event) => { setDefaultOpen(event.target.checked); }} />
          <span>
            Open by default on the site
            <small>Writes <code>defaultOpen</code> in its meta.yaml. Change it later from the folder’s ⋯ menu.</small>
          </span>
        </label>
      )}
      <Preview preview={preview} failed={failed} />
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-button studio-button-primary" disabled={request === null || preview?.error != null}>Create</button>
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
  const [failed, setFailed] = useState<string | null>(null);
  const slug = slugify(typed);
  const changed = slug !== '' && slug !== slugOf(node.path);
  // Moving the file under the editor would drop its pending save.
  const waiting = unsaved !== null && renamedPath(unsaved, node.path, node.path) !== null;
  const request: TreeRequest | null = changed ? { op: 'rename', path: node.path, slug } : null;
  const preview = usePreview(client, request);
  const dir = node.path.includes('/') ? `${node.path.slice(0, node.path.lastIndexOf('/'))}/` : '';

  const submit = () => {
    if (request === null || waiting) return;
    client.change(request).then(
      (answer) => {
        const move = answer.changes.find((change) => change.type === 'move');
        onDone(node.path, move?.type === 'move' ? move.to : node.path);
      },
      (reason: unknown) => { setFailed(reason instanceof Error ? reason.message : String(reason)); },
    );
  };

  return (
    <Dialog title={`Rename “${node.title}”`} onClose={onClose} onSubmit={submit}>
      <div className="grid gap-1">
        <label className="grid gap-1">
          <span className="studio-field-label">{node.kind === 'folder' ? 'Folder name' : 'File name'}</span>
          <input
            className="studio-input font-mono"
            autoFocus
            value={typed}
            onChange={(event) => { setTyped(event.target.value); setFailed(null); }}
          />
        </label>
        <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">
          URL: /notes/{dir}{slug}. Change the title at the top of the note.
        </span>
      </div>
      <Preview preview={preview} failed={failed} />
      {waiting && <p role="status" className="studio-tree-error">The open note has unsaved changes. Rename once it shows Saved.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-button studio-button-primary" disabled={!changed || waiting || preview?.error != null}>Rename</button>
      </div>
    </Dialog>
  );
}
