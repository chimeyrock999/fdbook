import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChangedFile, Changes, ChangesClient, Commit, History } from '../api/changes';
import { plural } from '../assets/asset-changes';
import { MAIN_BRANCH } from '../../server/git/branch';
import { labelOf, shortPath, timeAgo } from './labels';
import { CHANGE_NAME } from './marks';
import { suggestMessage } from './message';

type Result = { text: string; error: boolean };

// Why Commit is off, or null when it is on.
function blockedBy({ branch, unsaved, picked, message }: { branch: string | null; unsaved: string | null; picked: number; message: string }) {
  if (branch === null) return 'HEAD is detached: commit in a change request.';
  if (branch === MAIN_BRANCH) return `Commit in a change request, not on ${MAIN_BRANCH}.`;
  if (unsaved !== null) return `Saving ${unsaved}…`;
  if (picked === 0) return 'Pick at least one file.';
  if (message.trim() === '') return 'Write a commit message.';
  return null;
}

function FileGroup({ name, files, excluded, titles, readOnly, onToggle, onToggleAll, onOpen }: {
  name: string;
  // Main: listed, not picked.
  readOnly: boolean;
  files: ChangedFile[];
  excluded: Set<string>;
  titles: Map<string, string>;
  onToggle: (path: string, picked: boolean) => void;
  onToggleAll: (files: ChangedFile[], picked: boolean) => void;
  onOpen: (file: ChangedFile) => void;
}) {
  const all = useRef<HTMLInputElement>(null);
  const picked = files.filter((file) => !excluded.has(file.path)).length;
  useEffect(() => {
    if (all.current) all.current.indeterminate = picked > 0 && picked < files.length;
  }, [picked, files.length]);
  if (files.length === 0) return null;
  return (
    <section aria-label={name}>
      <div className="studio-changes-group">
        {!readOnly && <input ref={all} type="checkbox" aria-label={`Pick all ${name.toLowerCase()}`} checked={picked === files.length} onChange={(event) => { onToggleAll(files, event.target.checked); }} />}
        {name} <span className="studio-changes-count">{files.length}</span>
      </div>
      <ul className="studio-changes-files">
        {files.map((file) => {
          const label = labelOf(file, titles);
          return (
            <li key={file.path} className="studio-changes-file" data-change={file.status} title={file.from === undefined ? file.path : `${file.from} → ${file.path}`}>
              {!readOnly && <input type="checkbox" aria-label={`Commit ${shortPath(file.path)}`} checked={!excluded.has(file.path)} onChange={(event) => { onToggle(file.path, event.target.checked); }} />}
              <span className="studio-changes-what">
                {/* A note or an asset opens from here; a deleted file or a meta.yaml does not. */}
                <button type="button" className="studio-changes-name" onClick={() => { onOpen(file); }} disabled={file.status === 'D' || file.path.endsWith('/meta.yaml')}>
                  {label}
                </button>
                <small>{file.from === undefined ? shortPath(file.path) : `${shortPath(file.from)} → ${shortPath(file.path)}`}</small>
              </span>
              <span className="studio-change-mark" data-change={file.status} title={CHANGE_NAME[file.status]}>{file.status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CommitItem({ commit, open, unpushed, onToggle }: { commit: Commit; open: boolean; unpushed: boolean; onToggle: () => void }) {
  return (
    <li className="studio-changes-commit">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <ChevronRight size={14} data-open={open || undefined} className="studio-changes-chevron" />
        <span className="studio-changes-message">{commit.message}</span>
        <span className="studio-changes-sub">
          <time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>{timeAgo(commit.date)}</time>
          <span className="font-mono">{commit.sha.slice(0, 7)}</span>
          <span>{plural(commit.files.length, 'file')}</span>
          {unpushed && <span className="studio-changes-unpushed" title="Not pushed: not in the preview yet">↑ not pushed</span>}
        </span>
      </button>
      {open && (
        <ul className="studio-changes-commit-files">
          {commit.files.map((file) => (
            <li key={file.path}><b className="studio-change-mark" data-change={file.status}>{file.status}</b> {shortPath(file.path)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

// The Changes view (#17): the files changed in the worktree, a commit
// message, Commit, and the change request's commits. Every file starts
// picked, files that appear later too, and an unchecked file stays unchecked
// until it leaves the list; the message follows the picked files
// (suggestMessage) until it is edited. Commit waits while the open note has
// edits not saved yet (`unsaved`), as a rename does.
// `readOnly` (main with change requests) lists the changes and commits
// without the commit box: commits are made in a change request. `preview`
// (PreviewSection) goes above the history, whose commits in `unpushed` are
// marked as not pushed.
export function ChangesView({ client, changes, history, error, titles, unsaved, readOnly = false, preview = null, unpushed = null, onOpen, onCommitted }: {
  client: ChangesClient;
  changes: Changes | null;
  history: History | null;
  error: string | null;
  // Titles from the page tree, by worktree path (titlesOf).
  titles: Map<string, string>;
  unsaved: string | null;
  readOnly?: boolean;
  preview?: ReactNode;
  unpushed?: ReadonlySet<string> | null;
  // Opens a changed note or asset.
  onOpen: (file: ChangedFile) => void;
  onCommitted: () => Promise<void>;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  // null: the suggestion.
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [openCommit, setOpenCommit] = useState<string | null>(null);

  // A file that leaves the list (committed, here or in a terminal, or
  // reverted) is forgotten, so it comes back picked when it changes again.
  // Files still listed keep the pick they had. Done while rendering new
  // changes, so no render shows a pick for a file that left.
  const [prunedFor, setPrunedFor] = useState(changes);
  if (changes !== prunedFor) {
    setPrunedFor(changes);
    const listed = new Set(changes?.files.map((file) => file.path));
    if ([...excluded].some((path) => !listed.has(path))) setExcluded(new Set([...excluded].filter((path) => listed.has(path))));
  }

  if (changes === null) {
    return error === null
      ? <p className="studio-changes-note">Loading changes…</p>
      : <p role="alert" className="studio-changes-note studio-changes-error">Could not read the changes: {error}</p>;
  }

  const files = changes.files;
  const picked = files.filter((file) => !excluded.has(file.path));
  const message = edited ?? suggestMessage(picked);
  const blocked = busy ? 'Committing…' : blockedBy({ branch: changes.branch, unsaved, picked: picked.length, message });
  const pages = files.filter((file) => file.path.startsWith('content/'));
  const assets = files.filter((file) => file.path.startsWith('public/'));

  const toggle = (paths: string[], pick: boolean) => {
    setResult(null);
    setExcluded((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (pick) next.delete(path);
        else next.add(path);
      }
      return next;
    });
  };

  const commit = () => {
    setBusy(true);
    setResult(null);
    client.commit(message, picked.map((file) => file.path)).then(
      (made) => {
        setEdited(null);
        setOpenCommit(made.sha);
        setHistoryOpen(true);
        setResult({ text: `Committed ${plural(made.files.length, 'file')} (${made.sha.slice(0, 7)}).`, error: false });
      },
      (reason: unknown) => { setResult({ text: reason instanceof Error ? reason.message : String(reason), error: true }); },
    ).finally(() => {
      setBusy(false);
      void onCommitted();
    });
  };

  const commits = history?.commits ?? [];
  // What Commit did, or why it is off.
  const why = result?.text ?? (files.length > 0 ? blocked : null);
  const whyLine = why !== null && (
    <p role={result?.error ? 'alert' : 'status'} className="studio-changes-why" data-tone={result === null ? undefined : result.error ? 'error' : 'ok'}>
      {why}
    </p>
  );
  return (
    <div className="studio-changes">
      <h2 className="studio-pane-head studio-changes-head">
        Changes
        <span className="studio-changes-branch" title="The branch this worktree is on">{changes.branch ?? 'detached HEAD'}</span>
      </h2>
      {error !== null && <p role="alert" className="studio-changes-note studio-changes-error">Could not read the changes: {error}</p>}
      {readOnly ? (
        <p className="studio-changes-banner">Main is read only. Commit in a change request: pick one, or start one with Edit.</p>
      ) : changes.branch === MAIN_BRANCH && (
        <p className="studio-changes-banner">
          You are on <code>{MAIN_BRANCH}</code>. Open a change request to commit; your changes stay in the worktree.
        </p>
      )}
      {files.length === 0 ? (
        <>
          <p className="studio-changes-note">No changes to commit{changes.branch === null ? '' : <> on <code>{changes.branch}</code></>}.</p>
          {whyLine}
        </>
      ) : (
        <>
          {!readOnly && <div className="studio-changes-commit-box">
            <label htmlFor="studio-commit-message" className="studio-field-label">Commit message</label>
            <textarea
              id="studio-commit-message"
              className="studio-input studio-changes-input"
              rows={2}
              placeholder="docs(notes): …"
              value={message}
              aria-invalid={message.trim() === '' && picked.length > 0}
              onChange={(event) => {
                setResult(null);
                setEdited(event.target.value);
              }}
            />
            <p className="studio-changes-hint">
              {edited === null ? 'Suggested from the picked files.' : <>Edited. <button type="button" className="studio-changes-link" onClick={() => { setEdited(null); }}>Use the suggestion</button></>}
            </p>
            <button type="button" className="studio-button studio-button-primary studio-changes-submit" disabled={blocked !== null} onClick={commit}>
              Commit {plural(picked.length, 'file')}
            </button>
            {whyLine}
          </div>}
          <FileGroup name="Pages" files={pages} excluded={excluded} titles={titles} readOnly={readOnly} onOpen={onOpen}
            onToggle={(path, pick) => { toggle([path], pick); }} onToggleAll={(group, pick) => { toggle(group.map((file) => file.path), pick); }} />
          <FileGroup name="Assets" files={assets} excluded={excluded} titles={titles} readOnly={readOnly} onOpen={onOpen}
            onToggle={(path, pick) => { toggle([path], pick); }} onToggleAll={(group, pick) => { toggle(group.map((file) => file.path), pick); }} />
        </>
      )}
      {preview}
      <section className="studio-changes-history" aria-label="History">
        <button type="button" className="studio-changes-history-toggle" aria-expanded={historyOpen} onClick={() => { setHistoryOpen(!historyOpen); }}>
          <ChevronRight size={14} data-open={historyOpen || undefined} className="studio-changes-chevron" />
          History
          <span className="studio-changes-count">{history?.base ? `${plural(commits.length, 'commit')} since ${history.base}` : 'no main to compare with'}</span>
        </button>
        {historyOpen && (
          <ul className="studio-changes-commits">
            {commits.map((each) => (
              <CommitItem key={each.sha} commit={each} open={openCommit === each.sha} unpushed={unpushed?.has(each.sha) === true} onToggle={() => { setOpenCommit(openCommit === each.sha ? null : each.sha); }} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
