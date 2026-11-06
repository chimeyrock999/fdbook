import { ChevronLeft, FileX, Image, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { extensionOf } from '@fdbook/shared/asset-types.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import { messageOf } from '#components/toasts.ts';
import { NOW, type Comparison, type HistoryClient, type PageHistory } from '#api/history.ts';
import { ComparisonBody } from '#features/history/ComparisonBody.tsx';
import { isAsset, modesOf, type Mode } from '#features/history/modes.ts';
import { RestoreDeleted } from '#features/history/RestoreDeleted.tsx';
import { comparedWith, restoreBlocked, shortVersion, versionIds } from '#features/history/versions.ts';
import { VersionList } from '#features/history/VersionList.tsx';


function Options({ ids, selected, previous, history }: { ids: readonly string[]; selected: string; previous: string | null; history: PageHistory }) {
  const bySha = new Map(history.versions.map((version) => [version.sha, version]));
  return (
    <>
      <option value="">{previous === null ? 'Nothing: it starts here' : `Previous version (${shortVersion(previous)})`}</option>
      {ids.filter((id) => id !== selected && id !== previous).map((id) => (
        <option key={id} value={id}>{id === NOW ? 'Now (on disk)' : `${shortVersion(id)} · ${bySha.get(id)?.message ?? ''}`}</option>
      ))}
    </>
  );
}

// A note's or an asset's history, in the main pane (#22, #114): its
// versions on the left, newest first and across renames, and the one picked
// against the one before it, or any other ("Compare with"), on the right.
// Restore writes the picked version over the file, uncommitted, in the
// change request (an asset as Replace writes one); a page gone from the
// worktree comes back whole. Main is read only, and so is every file for a
// `reader`. `revision` changes when the file may have (a save, a commit),
// and the history loads again. `onOpen` opens the note in the editor or the
// asset page; `onRestored` follows a restore with where the file is now,
// `onBroughtBack` a deleted page's, with the page to open; `onDeletedList`
// goes back to the deleted pages.
export function HistoryPage({ client, path, title, readOnly, reader = false, revision, onOpen, onRestored, onBroughtBack, onDeletedList }: {
  client: HistoryClient;
  path: string;
  title: string;
  readOnly: boolean;
  reader?: boolean;
  revision: unknown;
  onOpen: () => void;
  onRestored: (path: string) => void;
  onBroughtBack?: (open: string) => void;
  onDeletedList?: () => void;
}) {
  const [history, setHistory] = useState<{ path: string; data: PageHistory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // What "Compare with" picked; null: the version before the selected one.
  const [against, setAgainst] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ key: string; data: Comparison } | null>(null);
  const [mode, setMode] = useState<Mode>('rendered');
  const [confirming, setConfirming] = useState(false);
  const action = useBusy();
  const restoring = action.busy;
  // The version last restored, while the page is still as the restore left
  // it: the same mtime, and no commit since.
  const [restored, setRestored] = useState<{ sha: string; mtimeMs: number; head: string | null } | null>(null);
  // On a phone the list and the comparison take turns.
  const [pane, setPane] = useState<'list' | 'detail'>('list');
  const [reloads, setReloads] = useState(0);
  const [shownFor, setShownFor] = useState(path);
  if (path !== shownFor) {
    setShownFor(path);
    setSelected(null);
    setAgainst(null);
    setRestored(null);
    setConfirming(false);
    setError(null);
    setPane('list');
  }

  useEffect(() => {
    let closed = false;
    client.loadHistory(path).then(
      (data) => {
        if (closed) return;
        setHistory({ path, data });
        setError(null);
      },
      (reason: unknown) => { if (!closed) setError(messageOf(reason)); },
    );
    return () => { closed = true; };
  }, [client, path, revision, reloads]);

  const data = history?.path === path ? history.data : null;
  const ids = data === null ? [] : versionIds(data, !readOnly);
  // The newest commit by default; Now for a page not committed yet.
  const shown = selected !== null && ids.includes(selected) ? selected : (data?.versions.at(0)?.sha ?? ids.at(0) ?? null);
  const head = data?.versions.at(0)?.sha ?? null;
  const restoredNow = restored !== null && data?.mtimeMs === restored.mtimeMs && head === restored.head ? restored.sha : null;
  const from = shown === null ? null : comparedWith(ids, shown, against);
  const key = `${path}\0${from ?? ''}\0${shown ?? ''}\0${String(data?.mtimeMs)}\0${String(head)}`;

  useEffect(() => {
    if (shown === null) return;
    let closed = false;
    client.compare(path, from, shown).then(
      (next) => {
        if (closed) return;
        setComparison({ key, data: next });
        setError(null);
      },
      (reason: unknown) => { if (!closed) setError(messageOf(reason)); },
    );
    return () => { closed = true; };
  }, [client, path, from, shown, key]);

  const select = (version: string) => {
    setSelected(version);
    setAgainst(null);
    setConfirming(false);
    setPane('detail');
  };
  const asset = isAsset(path);
  const gone = data !== null && data.mtimeMs === null;
  const blocked = shown === null || data === null ? 'Loading.' : restoreBlocked({ selected: shown, readOnly, reader, mtimeMs: data.mtimeMs, asset });

  // A failure says why in a toast, and the history is read again.
  const restore = () => {
    if (shown === null || data?.mtimeMs == null) return;
    const { mtimeMs } = data;
    void action.run(async () => {
      try {
        const answer = await client.restore(path, shown, mtimeMs);
        setRestored({ sha: shown, mtimeMs: answer.mtimeMs, head });
        setSelected(NOW);
        setAgainst(null);
        onRestored(answer.path);
      } catch (reason) {
        throw new Error(`Could not restore: ${messageOf(reason)}. The history is read again: look once more, then restore.`, { cause: reason });
      } finally {
        setConfirming(false);
        setReloads((count) => count + 1);
      }
    });
  };

  const version = data?.versions.find((each) => each.sha === shown);
  // What acts on the comparison, which a phone hides while it shows the list.
  const detailOnly = pane === 'list' ? 'max-md:hidden' : '';
  const shownComparison = comparison?.key === key ? comparison.data : null;
  const modes = modesOf(path, shownComparison);
  const shownMode = modes.includes(mode) ? mode : modes[0];
  // A version under another extension: the restore renames the asset, as Replace does.
  const renames = asset && version !== undefined && extensionOf(version.path) !== extensionOf(path);
  const what = asset ? 'asset' : 'page';

  return (
    <section className="studio-history-page" data-pane={pane} aria-label={`History of ${title}`}>
      <div className="studio-asset-page-bar">
        {pane === 'detail' && (
          <button type="button" className="studio-button gap-1 md:hidden" onClick={() => { setPane('list'); }}>
            <ChevronLeft size={14} aria-hidden /> Versions
          </button>
        )}
        <div className="studio-asset-page-title">
          <h1 className="flex min-w-0 items-center gap-2">
            <span className="studio-diff-name truncate">{title}</span>
            <span className="studio-history-chip">History</span>
            {gone && !asset && <span className="studio-history-chip" data-deleted>Deleted</span>}
          </h1>
          <span>{version?.from === undefined ? (version?.path ?? path) : `${version.from} → ${version.path}`}</span>
        </div>
        {modes.length > 1 && (
          <div role="tablist" aria-label="Diff mode" className={`${detailOnly} inline-flex rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-0.5`}>
            {modes.map((each) => (
              <button key={each} type="button" role="tab" aria-selected={shownMode === each} className="studio-diff-tab" onClick={() => { setMode(each); }}>
                {each === 'source' ? 'Source' : asset ? 'Preview' : 'Rendered'}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`studio-button gap-1.5 ${detailOnly}`}
          disabled={blocked !== null || restoring}
          title={blocked ?? `Restore the ${what} ${gone ? 'from' : 'to'} ${shortVersion(shown ?? '')}`}
          onClick={() => { setConfirming(true); }}
        >
          <RotateCcw size={13} aria-hidden /> {gone ? 'Restore page…' : 'Restore'}
        </button>
        {gone && !asset ? (
          onDeletedList && (
            <button type="button" className="studio-button gap-1.5" onClick={onDeletedList}>
              <FileX size={13} aria-hidden /> Deleted pages
            </button>
          )
        ) : (
          <button type="button" className="studio-button gap-1.5" disabled={gone} onClick={onOpen}>
            {asset ? <><Image size={13} aria-hidden /> Open asset page</> : <><Pencil size={13} aria-hidden /> Open in editor</>}
          </button>
        )}
      </div>
      {error !== null && <p role="alert" className="studio-diff-note studio-changes-error">{error}</p>}
      {data === null ? (
        error === null && <p className="studio-diff-note">Loading the history…</p>
      ) : (
        <div className="studio-history-body">
          <aside className="studio-history-versions" aria-label="Versions">
            <div className="studio-history-head">
              <span>Versions</span>
              <span>{ids.length}</span>
            </div>
            <VersionList ids={ids} versions={data.versions} deleted={data.deleted} selected={shown} restored={restoredNow} onSelect={select} />
            <p className="studio-history-foot">
              {gone && !asset ? 'Not in the worktree: restore a version to bring the page back.' : readOnly ? 'The history of main.' : 'Follows renames.'} Shows the latest 200 versions.
            </p>
          </aside>
          {shown !== null && (
            <div className="studio-history-detail">
              <p className="studio-diff-summary studio-history-compare">
                <span>Showing</span>
                <b className="font-mono">{shortVersion(shown)}</b>
                <label htmlFor="studio-history-against">Compare with</label>
                <select id="studio-history-against" value={against ?? ''} onChange={(event) => { setAgainst(event.target.value === '' ? null : event.target.value); }}>
                  <Options ids={ids} selected={shown} previous={comparedWith(ids, shown, null)} history={data} />
                </select>
                {blocked !== null && shown !== NOW && <span className="studio-history-hint">{blocked}</span>}
              </p>
              {confirming && gone && !asset && (
                <RestoreDeleted
                  client={client}
                  path={path}
                  sha={shown}
                  title={title}
                  onCancel={() => { setConfirming(false); }}
                  onDone={(answer) => {
                    setConfirming(false);
                    onBroughtBack?.(answer.open);
                  }}
                />
              )}
              {confirming && !gone && (
                <div role="alertdialog" aria-label="Restore this version" className="studio-history-confirm">
                  <p>
                    <b>Restore {title} to {shortVersion(shown)}?</b>{' '}
                    {renames
                      ? `This version is a .${extensionOf(version.path)} file: as with Replace, the asset takes that extension and every note that links to it follows.`
                      : asset
                        ? 'The asset becomes this version, under its current name; the notes that use it keep their links.'
                        : 'The page becomes this version, under its current name.'}
                    {' '}Nothing is committed: the change shows in Changes, and you commit it from there.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <PendingButton className="studio-button studio-history-danger" pending={restoring} pendingLabel="Restoring…" onClick={restore}>
                      Restore {shortVersion(shown)}
                    </PendingButton>
                    <button type="button" className="studio-button" disabled={restoring} onClick={() => { setConfirming(false); }}>Cancel</button>
                  </div>
                </div>
              )}
              {restoredNow !== null && shown === NOW && (
                <p role="status" className="studio-history-done">Restored {shortVersion(restoredNow)}. The {what} has uncommitted changes: commit them from Changes.</p>
              )}
              <div className="studio-diff-body">
                {shownComparison === null ? (
                  <p className="studio-diff-note">Loading the comparison…</p>
                ) : (
                  <ComparisonBody client={client} comparison={shownComparison} mode={shownMode} onUnparsed={() => { setMode('source'); }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
