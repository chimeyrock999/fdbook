import { ChevronLeft, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DiffSide } from '../api/changes';
import { NOW, type Comparison, type HistoryClient, type PageHistory } from '../api/history';
import { RenderedDiff } from '../diff/RenderedDiff';
import { SourceDiff } from '../diff/SourceDiff';
import { comparedWith, restoreBlocked, shortVersion, versionIds } from './versions';
import { VersionList } from './VersionList';

type Mode = 'rendered' | 'source';

const textOf = (side: DiffSide | null) => (side?.kind === 'text' ? side.text : null);
const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function Options({ ids, selected, previous, history }: { ids: readonly string[]; selected: string; previous: string | null; history: PageHistory }) {
  const bySha = new Map(history.versions.map((version) => [version.sha, version]));
  return (
    <>
      <option value="">{previous === null ? 'Nothing: the page starts here' : `Previous version (${shortVersion(previous)})`}</option>
      {ids.filter((id) => id !== selected && id !== previous).map((id) => (
        <option key={id} value={id}>{id === NOW ? 'Now (on disk)' : `${shortVersion(id)} · ${bySha.get(id)?.message ?? ''}`}</option>
      ))}
    </>
  );
}

// The comparison of two versions: the version `against` on the left (or
// nothing), the selected one on the right, rendered as the editor shows a
// note or as its source.
function ComparisonBody({ comparison, mode, onUnparsed }: { comparison: Comparison; mode: Mode; onUnparsed: () => void }) {
  const [before, after] = [textOf(comparison.before), textOf(comparison.after)];
  if ([comparison.before, comparison.after].some((side) => side?.kind === 'binary')) {
    return <p className="studio-diff-note">Too large to compare here.</p>;
  }
  if (comparison.after === null) return <p className="studio-diff-note">The page is not on disk.</p>;
  if (comparison.from !== null && before === after) {
    return <p className="studio-diff-note">Same content as {shortVersion(comparison.from.version)}.</p>;
  }
  if (mode === 'source') return <SourceDiff path={comparison.to.path} before={before ?? ''} after={after ?? ''} />;
  return <RenderedDiff before={before} after={after} onUnparsed={onUnparsed} />;
}

// A note's history, in the main pane (#22): its versions on the left,
// newest first and across renames, and the one picked against the one
// before it, or any other ("Compare with"), on the right. Restore writes
// the picked version over the page, uncommitted, in the change request;
// main is read only. `revision` changes when the page may have (a save, a
// commit), and the history loads again. `onOpen` opens the note in the
// editor; `onRestored` follows a restore (the changes list).
export function HistoryPage({ client, path, title, readOnly, revision, onOpen, onRestored }: {
  client: HistoryClient;
  path: string;
  title: string;
  readOnly: boolean;
  revision: unknown;
  onOpen: () => void;
  onRestored: () => void;
}) {
  const [history, setHistory] = useState<{ path: string; data: PageHistory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // What "Compare with" picked; null: the version before the selected one.
  const [against, setAgainst] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ key: string; data: Comparison } | null>(null);
  const [mode, setMode] = useState<Mode>('rendered');
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // The version last restored, while the page is still as the restore left
  // it: the same mtime, and no commit since.
  const [restored, setRestored] = useState<{ sha: string; mtimeMs: number; head: string | null } | null>(null);
  // Why the last restore failed: kept while the history loads again.
  const [refused, setRefused] = useState<string | null>(null);
  // On a phone the list and the comparison take turns.
  const [pane, setPane] = useState<'list' | 'detail'>('list');
  const [reloads, setReloads] = useState(0);
  const [shownFor, setShownFor] = useState(path);
  if (path !== shownFor) {
    setShownFor(path);
    setSelected(null);
    setAgainst(null);
    setRestored(null);
    setRefused(null);
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
  const blocked = shown === null || data === null ? 'Loading.' : restoreBlocked({ selected: shown, readOnly, mtimeMs: data.mtimeMs });

  const restore = async () => {
    if (shown === null || data?.mtimeMs == null) return;
    setRestoring(true);
    setRefused(null);
    try {
      const answer = await client.restore(path, shown, data.mtimeMs);
      setRestored({ sha: shown, mtimeMs: answer.mtimeMs, head });
      setSelected(NOW);
      setAgainst(null);
      onRestored();
    } catch (reason) {
      setRefused(`Could not restore: ${messageOf(reason)}. The history is read again: look once more, then restore.`);
    } finally {
      setRestoring(false);
      setConfirming(false);
      setReloads((count) => count + 1);
    }
  };

  const version = data?.versions.find((each) => each.sha === shown);
  // What acts on the comparison, which a phone hides while it shows the list.
  const detailOnly = pane === 'list' ? 'max-md:hidden' : '';
  const shownComparison = comparison?.key === key ? comparison.data : null;

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
          </h1>
          <span>{version?.from === undefined ? (version?.path ?? path) : `${version.from} → ${version.path}`}</span>
        </div>
        <div role="tablist" aria-label="Diff mode" className={`${detailOnly} inline-flex rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-0.5`}>
          {(['rendered', 'source'] as const).map((each) => (
            <button key={each} type="button" role="tab" aria-selected={mode === each} className="studio-diff-tab" onClick={() => { setMode(each); }}>
              {each === 'source' ? 'Source' : 'Rendered'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`studio-button gap-1.5 ${detailOnly}`}
          disabled={blocked !== null || restoring}
          title={blocked ?? `Restore the page to ${shortVersion(shown ?? '')}`}
          onClick={() => { setConfirming(true); }}
        >
          <RotateCcw size={13} aria-hidden /> Restore
        </button>
        <button type="button" className="studio-button gap-1.5" onClick={onOpen}>
          <Pencil size={13} aria-hidden /> Open in editor
        </button>
      </div>
      {[error, refused].map((message) => message !== null && <p key={message} role="alert" className="studio-diff-note studio-changes-error">{message}</p>)}
      {data === null ? (
        error === null && <p className="studio-diff-note">Loading the history…</p>
      ) : (
        <div className="studio-history-body">
          <aside className="studio-history-versions" aria-label="Versions">
            <div className="studio-history-head">
              <span>Versions</span>
              <span>{ids.length}</span>
            </div>
            <VersionList ids={ids} versions={data.versions} selected={shown} restored={restoredNow} onSelect={select} />
            <p className="studio-history-foot">{readOnly ? 'The history of main.' : 'Follows renames.'} Shows the latest 200 versions.</p>
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
              {confirming && (
                <div role="alertdialog" aria-label="Restore this version" className="studio-history-confirm">
                  <p>
                    <b>Restore {title} to {shortVersion(shown)}?</b> The page becomes this version, under its current name. Nothing is committed:
                    the change shows in Changes, and you commit it from there.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="studio-button studio-history-danger" disabled={restoring} onClick={() => { void restore(); }}>
                      Restore {shortVersion(shown)}
                    </button>
                    <button type="button" className="studio-button" onClick={() => { setConfirming(false); }}>Cancel</button>
                  </div>
                </div>
              )}
              {restoredNow !== null && shown === NOW && (
                <p role="status" className="studio-history-done">Restored {shortVersion(restoredNow)}. The page has uncommitted changes: commit them from Changes.</p>
              )}
              <div className="studio-diff-body">
                {shownComparison === null ? (
                  <p className="studio-diff-note">Loading the comparison…</p>
                ) : (
                  <ComparisonBody comparison={shownComparison} mode={mode} onUnparsed={() => { setMode('source'); }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
