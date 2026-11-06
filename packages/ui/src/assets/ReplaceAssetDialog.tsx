import { ArrowRight, FileCode } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ASSET_TYPES, extensionOf, isAssetExtension, MAX_ASSET_BYTES } from '@fdbook/shared/asset-types.ts';
import { useBusy } from '#actions/busy.ts';
import { PendingButton } from '#actions/PendingButton.tsx';
import type { AssetAnswer, AssetInfo, AssetRequest, AssetsClient } from '#api/assets.ts';
import { useAssetUrl } from '#api/asset-versions.ts';
import { imageExtension } from '#media/asset-names.ts';
import { Dialog } from '#tree/TreeDialogs.tsx';
import { formatSize, isImage } from './asset-facts';
import { nameOf } from './asset-tree';
import { usePreview } from './asset-changes';
import { Changes, Pick } from './AssetDialogs';

const ACCEPT = Object.keys(ASSET_TYPES).map((extension) => `.${extension}`).join(',');
const TYPES_LABEL = Object.keys(ASSET_TYPES).join(', ');

// The extension the file would be stored under, or null when the Studio
// does not store its type: its name's own, else, for an image without a
// usable name, its MIME type's.
function fileExtension(file: File) {
  const named = extensionOf(file.name);
  return isAssetExtension(named) ? named : imageExtension(file);
}

// The picked file as an image: a blob URL made and let go by one effect,
// set on the element directly. StrictMode's second setup makes a fresh one,
// and any unmount (the dialog closing, another asset or a note opening)
// lets it go, so the file is not kept alive.
function PickedImage({ file, onLoad }: { file: File; onLoad: (image: HTMLImageElement) => void }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    image.current?.setAttribute('src', url);
    return () => { URL.revokeObjectURL(url); };
  }, [file]);
  return <img ref={image} alt="" onLoad={(event) => { onLoad(event.currentTarget); }} />;
}

// One side of the comparison: the file (the asset's URL, or the picked
// file), its size and, for an image, its dimensions once it loaded.
function Side({ label, name, source, size }: { label: string; name: string; source: string | File; size: number }) {
  const [box, setBox] = useState<string | null>(null);
  const [boxFor, setBoxFor] = useState(source);
  // Dimensions belong to the file they were read from: another one starts without.
  if (source !== boxFor) {
    setBoxFor(source);
    setBox(null);
  }
  const loaded = (image: HTMLImageElement) => { setBox(`${String(image.naturalWidth)} × ${String(image.naturalHeight)}`); };
  return (
    <figure className="studio-asset-side" aria-label={label}>
      <div className="studio-asset-side-thumb">
        {isImage(name) ? (
          typeof source === 'string' ? <img src={source} alt="" onLoad={(event) => { loaded(event.currentTarget); }} /> : <PickedImage file={source} onLoad={loaded} />
        ) : (
          <FileCode size={28} aria-hidden />
        )}
      </div>
      <figcaption>
        <b>{name}</b>
        <span>{formatSize(size)}{box !== null && ` · ${box}`}</span>
        <span>{label}</span>
      </figcaption>
    </figure>
  );
}

// New content for an asset: a file picked here or dropped on the preview
// (`initial`). The old file and the new one show side by side with what
// the server would write. Same extension: only the file changes. Another
// one: the file takes it and every reference follows, as in a rename.
export function ReplaceAssetDialog({ client, asset, initial, onDone, onClose }: {
  client: AssetsClient;
  asset: AssetInfo;
  initial: File | null;
  onDone: (answer: AssetAnswer & { mtimeMs: number }) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(initial);
  const action = useBusy();
  const { busy } = action;
  const oldUrl = useAssetUrl(asset.path);

  const extension = file === null ? null : fileExtension(file);
  const refused =
    file === null ? null
    : extension === null ? `${file.name}: the Studio does not store this type. Use ${TYPES_LABEL}.`
    : file.size > MAX_ASSET_BYTES ? `${file.name} is larger than 25 MB, the most the Studio saves.`
    : null;
  const request: AssetRequest | null = file !== null && extension !== null && refused === null ? { op: 'replace', path: asset.path, extension, baseMtime: asset.mtimeMs } : null;
  const planned = usePreview(client, request);
  const renames = extension !== null && extension !== extensionOf(asset.path);

  const pick = (next: File | undefined) => {
    if (next === undefined) return;
    setFile(next);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    pick(event.dataTransfer.files[0]);
  };
  // A failure says why in a toast; the dialog stays, to try again.
  const submit = () => {
    if (request === null || file === null || planned?.error != null) return;
    void action.run(async () => { onDone(await client.replace(asset.path, request.extension, file, asset.mtimeMs)); });
  };

  return (
    <Dialog title={`Replace “${nameOf(asset.path)}”`} busy={busy} onClose={onClose} onSubmit={submit}>
      <Pick asset={asset} />
      <div className="studio-asset-pair">
        <Side label="now" name={nameOf(asset.path)} source={oldUrl} size={asset.size} />
        <ArrowRight size={16} aria-hidden className="studio-asset-pair-arrow" />
        {file === null ? (
          <p className="studio-asset-side studio-asset-side-empty">No file picked yet.</p>
        ) : (
          <Side label="picked" name={file.name} source={file} size={file.size} />
        )}
      </div>
      <label className="studio-asset-drop" onDragOver={(event) => { event.preventDefault(); }} onDrop={drop}>
        <input type="file" accept={ACCEPT} className="sr-only" onChange={(event) => { pick(event.target.files?.[0]); }} />
        {file === null ? 'Pick a file, or drop one here' : 'Pick another file, or drop one here'} · {TYPES_LABEL} · up to 25 MB
      </label>
      {refused !== null && <p role="alert" className="studio-tree-error">{refused}</p>}
      {renames && refused === null && (
        <p className="studio-asset-warn">
          <b>Different type.</b> The file becomes {nameOf(asset.path).replace(/\.[^.]+$/, `.${extension}`)}, and the notes that use it follow. Everything else in those notes stays as it is.
        </p>
      )}
      {planned?.error != null ? (
        <p role="alert" className="studio-tree-error">{planned.error}</p>
      ) : (
        planned && <Changes changes={planned.changes} />
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-primary" pending={busy} pendingLabel="Replacing…" disabled={request === null || planned?.error != null}>
          {renames ? 'Replace and rename' : 'Replace'}
        </PendingButton>
      </div>
    </Dialog>
  );
}
