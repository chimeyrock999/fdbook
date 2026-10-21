import { FileCode, Pencil, Trash2, Upload } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { ASSETS_DIR, extensionOf } from '../../server/security/asset-types';
import type { AssetAnswer, AssetInfo, AssetsClient, AssetUsage } from '../api/assets';
import { assetChanged, useAssetUrl } from '../api/asset-versions';
import { formatSize, isImage } from './asset-facts';
import { nameOf } from './asset-tree';
import { movedTo, plural, said } from './asset-changes';
import { DeleteAssetDialog, RenameAssetDialog, SourceList, UsageList } from './AssetDialogs';
import { ReplaceAssetDialog } from './ReplaceAssetDialog';
import type { useAssetList } from './useAssetList';

type Dialog = { kind: 'rename' | 'delete' } | { kind: 'replace'; file: File | null };

// The file itself: an image fitted to the pane (or at 100%), an HTML embed
// in a sandboxed frame (the file API serves it with scripts off), else an
// icon. Reports an image's dimensions once it loaded.
function Preview({ asset, zoom, onBox }: { asset: AssetInfo; zoom: 'fit' | 'actual'; onBox: (box: string) => void }) {
  const url = useAssetUrl(asset.path);
  const name = nameOf(asset.path);
  if (isImage(name)) {
    return (
      <img
        src={url}
        alt={`Preview of ${name}`}
        data-zoom={zoom}
        onLoad={(event) => { onBox(`${String(event.currentTarget.naturalWidth)} × ${String(event.currentTarget.naturalHeight)} px`); }}
      />
    );
  }
  if (extensionOf(name) === 'html') {
    return <iframe src={url} sandbox="" title={`Preview of ${name}`} />;
  }
  return (
    <p className="studio-asset-noview">
      <FileCode size={28} aria-hidden />
      The Studio has no preview for .{extensionOf(name)} files.
    </p>
  );
}

// An asset opened in the main pane: its preview, size and dimensions, the
// notes and lines that use it, the diagram sources that generate it, and
// rename, replace and delete. `path` is its worktree path; `list` the
// assets as listed (the page shows the asset as listed now). Rename and
// delete wait while the open note is `unsaved`, as in the sidebar.
// `onChanged` hears every change, so the URL can follow a move.
export function AssetPage({ client, list, path, unsaved, onOpenUsage, onChanged }: {
  client: AssetsClient;
  list: ReturnType<typeof useAssetList>;
  path: string;
  unsaved: boolean;
  onOpenUsage: (usage: AssetUsage) => void;
  onChanged: (answer: AssetAnswer) => void;
}) {
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const [box, setBox] = useState<{ path: string; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // What the last change said, for the asset it left open (or deleted).
  const [status, setStatus] = useState<{ path: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shownFor, setShownFor] = useState(path);

  // Another asset opened (back, forward, the sidebar): nothing picked for the
  // last one carries over. A status stays, as it names its own path.
  if (path !== shownFor) {
    setShownFor(path);
    setDialog(null);
    setZoom('fit');
    setDragging(false);
  }

  const { assets, error, reload } = list;
  const shownStatus = status?.path === path ? status.text : null;
  if (assets === null) {
    return error === null
      ? <p className="studio-asset-page-note">Loading {nameOf(path)}…</p>
      : <p role="alert" className="studio-asset-page-note text-[var(--fde-error)]">Could not load the assets: {error}</p>;
  }
  const asset = assets.find((each) => each.path === path);
  if (!asset) {
    return (
      <p role="status" className="studio-asset-page-note">
        {shownStatus ?? `${path} is not in public/notes: it may have been renamed or deleted.`}
      </p>
    );
  }

  const name = nameOf(asset.path);
  const used = asset.usages.length;
  const generated = asset.sources.length > 0;
  const done = (answer: AssetAnswer & { mtimeMs?: number }) => {
    setDialog(null);
    const to = movedTo(answer);
    if (answer.mtimeMs !== undefined && to === null) assetChanged(asset.path, answer.mtimeMs);
    setStatus({ path: to ?? asset.path, text: said(answer) });
    onChanged(answer);
    reload();
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0] as File | undefined;
    if (file && !generated && !unsaved) setDialog({ kind: 'replace', file });
  };
  const waitHint = unsaved ? 'The open note has unsaved changes. Rename or delete once it shows Saved.' : undefined;
  const deleteHint = generated ? 'A diagram generates it: change the diagram instead' : used > 0 ? `Still used ${plural(used, 'time')}` : waitHint;

  return (
    <section className="studio-asset-page" aria-label={`Asset ${name}`}>
      <div className="studio-asset-page-bar">
        <div className="studio-asset-page-title">
          <h1>{name}</h1>
          <span>{asset.path}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="studio-button gap-1.5"
            disabled={generated || unsaved}
            title={generated ? 'A diagram generates it: change the diagram instead' : waitHint}
            onClick={() => { setDialog({ kind: 'replace', file: null }); }}
          >
            <Upload size={14} aria-hidden /> Replace…
          </button>
          <button type="button" className="studio-button gap-1.5" disabled={unsaved} title={waitHint} onClick={() => { setDialog({ kind: 'rename' }); }}>
            <Pencil size={14} aria-hidden /> Rename…
          </button>
          <button
            type="button"
            className="studio-button studio-asset-delete gap-1.5"
            disabled={unsaved || used > 0 || generated}
            title={deleteHint}
            onClick={() => { setDialog({ kind: 'delete' }); }}
          >
            <Trash2 size={14} aria-hidden /> Delete…
          </button>
        </div>
      </div>
      <div className="studio-asset-page-body">
        {shownStatus !== null && <p role="status" className="studio-tree-status">{shownStatus}</p>}
        <div className="studio-asset-preview">
          <div className="studio-asset-preview-tools">
            {isImage(name) ? (
              <div className="studio-asset-filter" role="group" aria-label="Zoom">
                <button type="button" aria-pressed={zoom === 'fit'} onClick={() => { setZoom('fit'); }}>Fit</button>
                <button type="button" aria-pressed={zoom === 'actual'} onClick={() => { setZoom('actual'); }}>100%</button>
              </div>
            ) : (
              <span>{extensionOf(name).toUpperCase()} file</span>
            )}
            <span className="flex-1" />
            {!generated && <span>Drop a file here to replace it</span>}
          </div>
          <div
            className="studio-asset-canvas"
            data-drop={dragging || undefined}
            onDragOver={(event) => {
              if (generated || !event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => { setDragging(false); }}
            onDrop={drop}
          >
            <Preview asset={asset} zoom={zoom} onBox={(text) => { setBox({ path: asset.path, text }); }} />
          </div>
        </div>
        <div className="studio-asset-info">
          <div className="studio-asset-panel">
            <h2>File</h2>
            <dl>
              <dt>Path</dt>
              <dd className="font-mono text-[12px]">{asset.path.slice(ASSETS_DIR.length + 1)}</dd>
              <dt>Size</dt>
              <dd>{formatSize(asset.size)}</dd>
              {box?.path === asset.path && (
                <>
                  <dt>Dimensions</dt>
                  <dd>{box.text}</dd>
                </>
              )}
              <dt>Modified</dt>
              <dd>{new Date(asset.mtimeMs).toLocaleString()}</dd>
            </dl>
          </div>
          <div className="grid min-w-0 gap-4">
            <div className="studio-asset-panel">
              <h2>Used in · {used}</h2>
              {used === 0 ? <p className="studio-tree-status">No note uses it.</p> : <UsageList usages={asset.usages} onOpen={onOpenUsage} />}
            </div>
            {generated && (
              <div className="studio-asset-panel">
                <h2>Generated by · {asset.sources.length}</h2>
                <SourceList sources={asset.sources} />
                <p className="studio-asset-warn">
                  <b>Generated file.</b> Regenerating writes it again, so Replace and Delete are off. The Studio does not edit these sources: change the diagram, then regenerate.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {dialog?.kind === 'rename' && <RenameAssetDialog client={client} asset={asset} onDone={done} onClose={() => { setDialog(null); }} />}
      {dialog?.kind === 'delete' && (
        <DeleteAssetDialog
          client={client}
          asset={asset}
          onDone={done}
          onClose={() => { setDialog(null); }}
          onOpenUsage={(usage) => { setDialog(null); onOpenUsage(usage); }}
        />
      )}
      {dialog?.kind === 'replace' && <ReplaceAssetDialog client={client} asset={asset} initial={dialog.file} onDone={done} onClose={() => { setDialog(null); }} />}
    </section>
  );
}
