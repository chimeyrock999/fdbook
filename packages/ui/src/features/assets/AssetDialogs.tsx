import { useState } from 'react';
import { extensionOf } from '@fdbook/shared/asset-types.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import type { AssetAnswer, AssetChange, AssetInfo, AssetRequest, AssetsClient, AssetUsage } from '#api/assets.ts';
import { sitePath } from '#features/media/asset-names.ts';
import { slugify } from '@fdbook/shared/slug.ts';
import { Dialog } from '#components/Dialog.tsx';
import { usePreview } from './asset-changes';
import { nameOf } from './asset-tree';

const stemOf = (path: string) => nameOf(path).slice(0, nameOf(path).lastIndexOf('.'));

export function Changes({ changes }: { changes: AssetChange[] }) {
  return (
    <div className="grid gap-1">
      <span className="studio-field-label">Writes</span>
      <ul className="studio-tree-changes" aria-label="Files to write">
        {changes.map((change) => (
          <li key={`${change.type}:${change.path}`} data-change={change.type}>
            {change.type === 'move' && `${change.path} → ${nameOf(change.to)}`}
            {change.type === 'change' && (
              <>
                ~ {change.path} <span>{change.detail}</span>
              </>
            )}
            {change.type === 'delete' && `− ${change.path}`}
            {change.type === 'replace' && (
              <>
                {change.to === change.path ? `⟳ ${change.path}` : `${change.path} → ${nameOf(change.to)}`}{' '}
                <span>{change.to === change.path ? 'new content; notes stay as they are' : 'new content'}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A note as the usage list names it: its file, or for a folder page
// (`…/index.mdx`, of which there are many) its folder.
function noteName(path: string) {
  const parts = path.replace(/\.mdx$/, '').split('/');
  return parts.at(-1) === 'index' && parts.length > 3 ? (parts.at(-2) ?? '') : (parts.at(-1) ?? '');
}

// The notes and lines that use an asset; picking one opens it there.
export function UsageList({ usages, onOpen }: { usages: AssetUsage[]; onOpen: (usage: AssetUsage) => void }) {
  return (
    <ul className="studio-asset-usages" aria-label="Used in">
      {usages.map((usage, index) => (
        <li key={`${usage.note}:${String(usage.line)}:${String(index)}`}>
          <button type="button" title={`${usage.note}, line ${String(usage.line)}`} onClick={() => { onOpen(usage); }}>
            <span className="studio-asset-usage-note">{noteName(usage.note)}</span>
            <span className="studio-asset-usage-line">
              L{usage.line}
              {usage.unsure && ' · cannot rewrite'}
            </span>
            <code>{usage.text}</code>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Pick({ asset }: { asset: AssetInfo }) {
  return <p className="studio-asset-pick">{asset.path}</p>;
}

// A new name for the asset in its folder; the extension stays.
export function RenameAssetDialog({ client, asset, onDone, onClose }: {
  client: AssetsClient;
  asset: AssetInfo;
  onDone: (answer: AssetAnswer) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(stemOf(asset.path));
  const action = useBusy();
  const name = slugify(typed);
  const extension = extensionOf(asset.path);
  // The name as it was is no change, even when it is not in slug form yet:
  // only what the person types is.
  const changed = name !== '' && typed !== stemOf(asset.path) && name !== stemOf(asset.path);
  const request: AssetRequest | null = changed ? { op: 'rename', path: asset.path, name, baseMtime: asset.mtimeMs } : null;
  const preview = usePreview(client, request);
  const to = `${asset.path.slice(0, asset.path.lastIndexOf('/'))}/${name || '…'}.${extension}`;

  // A failure says why in a toast; the dialog stays, to try again.
  const submit = () => {
    if (request === null || preview?.error != null) return;
    void action.run(async () => { onDone(await client.change(request)); });
  };

  return (
    <Dialog title={`Rename “${nameOf(asset.path)}”`} busy={action.busy} onClose={onClose} onSubmit={submit}>
      <Pick asset={asset} />
      <div className="grid gap-1">
        <label htmlFor="asset-rename" className="studio-field-label">File name</label>
        <div className="studio-asset-name">
          <input
            id="asset-rename"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={typed}
            onChange={(event) => { setTyped(event.target.value); }}
          />
          <span>.{extension}</span>
        </div>
        <span className="text-[11.5px] break-all text-[var(--fde-muted-foreground)]">
          Notes get {sitePath(to)}; a query or hash after it stays.
        </span>
      </div>
      {preview?.error != null ? (
        <p role="alert" className="studio-tree-error">{preview.error}</p>
      ) : (
        preview && <Changes changes={preview.changes} />
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={action.busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-primary" pending={action.busy} pendingLabel="Renaming…" disabled={!changed || preview?.error != null}>Rename</PendingButton>
      </div>
    </Dialog>
  );
}

// Deletes an asset no note uses. Otherwise the dialog lists the uses
// instead, and offers no delete.
export function DeleteAssetDialog({ client, asset, onDone, onClose, onOpenUsage }: {
  client: AssetsClient;
  asset: AssetInfo;
  onDone: (answer: AssetAnswer) => void;
  onClose: () => void;
  onOpenUsage: (usage: AssetUsage) => void;
}) {
  const action = useBusy();
  const used = asset.usages.length;
  const submit = () => {
    if (used > 0) return;
    void action.run(async () => { onDone(await client.change({ op: 'delete', path: asset.path, baseMtime: asset.mtimeMs })); });
  };

  return (
    <Dialog title={`Delete “${nameOf(asset.path)}”?`} busy={action.busy} onClose={onClose} onSubmit={submit}>
      <Pick asset={asset} />
      {used > 0 ? (
        <>
          <p role="alert" className="studio-tree-error">
            {used === 1 ? 'A note still uses it' : `${String(used)} places still use it`}: remove {used === 1 ? 'that reference' : 'those references'} first, or the site shows a placeholder.
          </p>
          <UsageList usages={asset.usages} onOpen={onOpenUsage} />
          <div className="flex justify-end gap-2">
            <button type="button" className="studio-button" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] text-[var(--fde-muted-foreground)]">No note uses it. The file is removed from the worktree; git still has it if it was committed.</p>
          <Changes changes={[{ type: 'delete', path: asset.path }]} />
          <div className="flex justify-end gap-2">
            <button type="button" className="studio-button" disabled={action.busy} onClick={onClose}>Cancel</button>
            <PendingButton type="submit" className="studio-button studio-button-danger" autoFocus pending={action.busy} pendingLabel="Deleting…">Delete</PendingButton>
          </div>
        </>
      )}
    </Dialog>
  );
}
