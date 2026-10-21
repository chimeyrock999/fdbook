import { ChevronLeft, FileCode, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { extensionOf, isTextPath } from '../../server/security/asset-types';
import type { ChangesClient, DiffSide, FileDiff } from '../api/changes';
import { useAssetUrl } from '../api/asset-versions';
import { formatSize, isImage } from '../assets/asset-facts';
import { CHANGE_NAME } from '../changes/marks';
import { labelOf } from '../changes/labels';
import { RenderedDiff } from './RenderedDiff';
import { SourceDiff } from './SourceDiff';

// A file to compare with main: its worktree path, and its old one when it
// was renamed.
export type DiffTarget = { path: string; from?: string };
type Mode = 'rendered' | 'source';

const textOf = (side: DiffSide | null) => (side?.kind === 'text' ? side.text : null);

// Which views a file has: a note renders and has its source; an image
// previews, and an SVG has its source too; a meta.yaml or an HTML asset has
// its source only; any other asset previews as its sizes. A text file too
// large to send as text has none (`tooLarge`).
function modesOf(diff: FileDiff): Mode[] {
  const text = [diff.before, diff.after].every((side) => side === null || side.kind === 'text');
  if (tooLarge(diff)) return [];
  if (diff.path.endsWith('.mdx')) return ['rendered', 'source'];
  if (diff.path.endsWith('/meta.yaml') || extensionOf(diff.path) === 'html') return ['source'];
  return text ? ['rendered', 'source'] : ['rendered'];
}

// A note, meta.yaml or HTML file the server sent only the sizes of.
function tooLarge(diff: FileDiff) {
  return isTextPath(diff.path) && [diff.before, diff.after].some((side) => side?.kind === 'binary');
}

const sizeOf = (side: DiffSide | null, missing: string) => (side === null ? missing : formatSize(side.size));

function ImageSide({ label, side, url, empty }: { label: string; side: DiffSide | null; url: string; empty: string }) {
  const [box, setBox] = useState<string | null>(null);
  return (
    <figure className="studio-diff-image" data-side={label === 'Main' ? 'before' : 'after'}>
      <figcaption>
        <b>{label}</b>
        <span>{side === null ? '—' : [formatSize(side.size), box].filter(Boolean).join(' · ')}</span>
      </figcaption>
      {side === null ? (
        <p className="studio-diff-note">{empty}</p>
      ) : (
        <div className="studio-diff-checker">
          <img src={url} alt={`${label} version`} onLoad={(event) => { setBox(`${String(event.currentTarget.naturalWidth)} × ${String(event.currentTarget.naturalHeight)} px`); }} />
        </div>
      )}
    </figure>
  );
}

// An asset on main and now, side by side: an image as it looks, any other
// file as its size.
function AssetPreview({ client, diff }: { client: ChangesClient; diff: FileDiff }) {
  const after = useAssetUrl(diff.path);
  if (!isImage(diff.path)) {
    return (
      <div className="studio-diff-images">
        <p className="studio-asset-noview">
          <FileCode size={28} aria-hidden />
          The Studio has no preview for .{extensionOf(diff.path)} files.
          {' '}{sizeOf(diff.before, 'New')} → {sizeOf(diff.after, 'deleted')}
        </p>
      </div>
    );
  }
  const before = diff.base === null ? '' : client.baseFileUrl(diff.from ?? diff.path, diff.base);
  return (
    <div className="studio-diff-images">
      <ImageSide label="Main" side={diff.before} url={before} empty="Not on main: new in this change request." />
      <ImageSide label="Now" side={diff.after} url={after} empty="Deleted in this change request." />
    </div>
  );
}

function summaryOf(diff: FileDiff) {
  if (diff.base === null) return 'No main to compare with: showing the file as it is.';
  const at = `merge base ${diff.base.slice(0, 7)}`;
  if (diff.before === null) return `Not on main (${at}): new in this change request.`;
  if (diff.status === 'same') return `Same as main at ${at}.`;
  return `Against main at ${at}, as the worktree holds it now, committed or not.`;
}

// A changed file against main, in the main pane: what main held where the
// change request left it, against what the worktree holds now, committed or
// not. Rendered shows a note as the editor does, or an image; Source is the
// raw text diff. `revision` changes when the changes may have (a save, a
// commit), and the diff loads again. `onOpen` opens the file in the editor
// or the asset page; `onBack` goes back to the Changes list (phones).
export function DiffPage({ client, target, revision, titles, onOpen, onBack }: {
  client: ChangesClient;
  target: DiffTarget;
  revision: unknown;
  titles: Map<string, string>;
  onOpen: (path: string) => void;
  onBack: () => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; diff: FileDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const key = `${target.from ?? ''}\0${target.path}`;
  const [shownFor, setShownFor] = useState(key);
  if (key !== shownFor) {
    setShownFor(key);
    setMode(null);
    setError(null);
  }

  useEffect(() => {
    let closed = false;
    client.loadDiff(target.path, target.from).then(
      (diff) => {
        if (closed) return;
        setLoaded({ key, diff });
        setError(null);
      },
      (reason: unknown) => { if (!closed) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { closed = true; };
  }, [client, target.path, target.from, key, revision]);

  const diff = loaded?.key === key ? loaded.diff : null;
  const title = labelOf({ path: target.path, status: 'M' }, titles);
  const modes = diff ? modesOf(diff) : [];
  const shown = mode !== null && modes.includes(mode) ? mode : (modes[0] ?? null);
  // A file still there opens in the editor or on its asset page; a meta.yaml has neither.
  const editable = (diff?.after ?? null) !== null && !target.path.endsWith('/meta.yaml');
  const status = diff?.status ?? null;

  return (
    <section className="studio-diff-page" aria-label={`Diff of ${title}`}>
      <div className="studio-asset-page-bar">
        <button type="button" className="studio-button gap-1 md:hidden" onClick={onBack}>
          <ChevronLeft size={14} aria-hidden /> Changes
        </button>
        <div className="studio-asset-page-title">
          <h1 className="flex min-w-0 items-center gap-2">
            <span className="studio-diff-name truncate">{title}</span>
            {status !== null && status !== 'same' && (
              <span className="studio-diff-chip" data-change={status} title={CHANGE_NAME[status]}>{status}</span>
            )}
          </h1>
          <span>{target.from === undefined ? target.path : `${target.from} → ${target.path}`}</span>
        </div>
        {modes.length > 1 && (
          <div role="tablist" aria-label="Diff mode" className="inline-flex rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-0.5">
            {modes.map((each) => (
              <button
                key={each}
                type="button"
                role="tab"
                aria-selected={shown === each}
                className="studio-diff-tab"
                onClick={() => { setMode(each); }}
              >
                {each === 'source' ? 'Source' : diff?.path.endsWith('.mdx') ? 'Rendered' : 'Preview'}
              </button>
            ))}
          </div>
        )}
        {editable && (
          <button type="button" className="studio-button gap-1.5" onClick={() => { onOpen(target.path); }}>
            <Pencil size={13} aria-hidden /> Open in editor
          </button>
        )}
      </div>
      {error !== null && <p role="alert" className="studio-diff-note studio-changes-error">Could not load the diff: {error}</p>}
      {diff === null ? (
        error === null && <p className="studio-diff-note">Loading the diff…</p>
      ) : (
        <>
          <p className="studio-diff-summary">{summaryOf(diff)}</p>
          <div className="studio-diff-body">
            {tooLarge(diff) ? (
              <p className="studio-diff-note">
                Too large to compare here: {sizeOf(diff.before, 'not on main')} on main, {sizeOf(diff.after, 'deleted')} now.
              </p>
            ) : shown === 'source' ? (
              <SourceDiff path={diff.path} before={textOf(diff.before) ?? ''} after={textOf(diff.after) ?? ''} />
            ) : diff.path.endsWith('.mdx') ? (
              <RenderedDiff before={textOf(diff.before)} after={textOf(diff.after)} onUnparsed={() => { setMode('source'); }} />
            ) : (
              <AssetPreview client={client} diff={diff} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
