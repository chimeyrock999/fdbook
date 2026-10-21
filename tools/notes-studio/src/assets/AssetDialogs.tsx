import { useEffect, useState } from 'react';
import { extensionOf } from '../../server/security/asset-types';
import type { AssetAnswer, AssetChange, AssetInfo, AssetRequest, AssetsClient, AssetUsage } from '../api/assets';
import { sitePath } from '../media/asset-names';
import { slugify } from '../slug';
import { Dialog } from '../tree/TreeDialogs';
import { nameOf } from './asset-tree';

const PREVIEW_MS = 200;

const stemOf = (path: string) => nameOf(path).slice(0, nameOf(path).lastIndexOf('.'));
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// What the server would write for `request`, asked again as it changes.
function usePreview(client: AssetsClient, request: AssetRequest | null) {
  const [preview, setPreview] = useState<{ changes: AssetChange[]; error: string | null } | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (request === null) return;
    let current = true;
    const timer = setTimeout(() => {
      client.change(request, true).then(
        (answer) => { if (current) setPreview({ changes: answer.changes, error: null }); },
        (reason: unknown) => { if (current) setPreview({ changes: [], error: message(reason) }); },
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

function Changes({ changes }: { changes: AssetChange[] }) {
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
              {usage.unsure && ' · does not parse'}
            </span>
            <code>{usage.text}</code>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Pick({ asset }: { asset: AssetInfo }) {
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
  const [failed, setFailed] = useState<string | null>(null);
  const name = slugify(typed);
  const extension = extensionOf(asset.path);
  // The name as it was is no change, even when it is not in slug form yet:
  // only what the person types is.
  const changed = name !== '' && typed !== stemOf(asset.path) && name !== stemOf(asset.path);
  const request: AssetRequest | null = changed ? { op: 'rename', path: asset.path, name, baseMtime: asset.mtimeMs } : null;
  const preview = usePreview(client, request);
  const to = `${asset.path.slice(0, asset.path.lastIndexOf('/'))}/${name || '…'}.${extension}`;

  const submit = () => {
    if (request === null) return;
    client.change(request).then(onDone, (reason: unknown) => { setFailed(message(reason)); });
  };

  return (
    <Dialog title={`Rename “${nameOf(asset.path)}”`} onClose={onClose} onSubmit={submit}>
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
            onChange={(event) => { setTyped(event.target.value); setFailed(null); }}
          />
          <span>.{extension}</span>
        </div>
        <span className="text-[11.5px] break-all text-[var(--fde-muted-foreground)]">
          Notes get {sitePath(to)}; a query or hash after it stays.
        </span>
      </div>
      {failed !== null ? (
        <p role="alert" className="studio-tree-error">{failed}</p>
      ) : preview?.error != null ? (
        <p role="alert" className="studio-tree-error">{preview.error}</p>
      ) : (
        preview && <Changes changes={preview.changes} />
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-button studio-button-primary" disabled={!changed || preview?.error != null}>Rename</button>
      </div>
    </Dialog>
  );
}

// Deletes an asset no note uses. While notes use it, the dialog lists them
// instead, and offers no delete.
export function DeleteAssetDialog({ client, asset, onDone, onClose, onOpenUsage }: {
  client: AssetsClient;
  asset: AssetInfo;
  onDone: (answer: AssetAnswer) => void;
  onClose: () => void;
  onOpenUsage: (usage: AssetUsage) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const used = asset.usages.length;
  const submit = () => {
    if (used > 0) return;
    client.change({ op: 'delete', path: asset.path, baseMtime: asset.mtimeMs }).then(onDone, (reason: unknown) => { setFailed(message(reason)); });
  };

  return (
    <Dialog title={`Delete “${nameOf(asset.path)}”?`} onClose={onClose} onSubmit={submit}>
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
          {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="studio-button studio-button-danger" autoFocus>Delete</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
