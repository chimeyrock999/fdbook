import { useEffect, useState } from 'react';
import type { DeletedRestore, HistoryClient } from '../api/history';
import { shortVersion } from './versions';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// Asks before a deleted page comes back as version `sha`, listing every
// file the restore writes (a dry run): the page, the folders deleted with
// it, and the meta.yaml that lists it again. Nothing is committed.
// `onDone` hears the restore; `onCancel` closes the question.
export function RestoreDeleted({ client, path, sha, title, onDone, onCancel }: {
  client: HistoryClient;
  path: string;
  sha: string;
  title: string;
  onDone: (restored: DeletedRestore) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<{ key: string; data: DeletedRestore } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = `${path}\0${sha}`;

  useEffect(() => {
    let closed = false;
    client.restoreDeleted(path, sha, true).then(
      (data) => { if (!closed) setPlan({ key, data }); },
      (reason: unknown) => { if (!closed) setError(messageOf(reason)); },
    );
    return () => { closed = true; };
  }, [client, path, sha, key]);

  const shown = plan?.key === key ? plan.data : null;
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await client.restoreDeleted(path, sha));
    } catch (reason) {
      setError(`Could not restore: ${messageOf(reason)}`);
    } finally {
      setBusy(false);
    }
  };
  const folders = shown?.changes.some((change) => change.type === 'add' && change.path !== path) === true;

  return (
    <div role="alertdialog" aria-label="Restore this page" className="studio-history-confirm">
      <p>
        <b>Restore {title} from {shortVersion(sha)}?</b>{' '}
        {folders ? 'Its folder was deleted with it, so the folder comes back too, as it was just before the delete, listing only this page. ' : ''}
        Nothing is committed: the change shows in Changes, and you commit it from there.
      </p>
      {error !== null && <p role="alert" className="studio-changes-error">{error}</p>}
      {shown === null ? (
        error === null && <p className="studio-diff-note">Reading what the restore writes…</p>
      ) : (
        <ul className="studio-history-writes" aria-label="Files the restore writes">
          {shown.changes.map((change) => (
            <li key={change.path}>
              <span className="studio-history-write" data-change={change.type === 'add' ? 'A' : 'M'}>{change.type === 'add' ? 'A' : 'M'}</span>
              <span className="font-mono">{change.path}{change.detail === undefined ? '' : `: ${change.detail}`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="studio-button studio-history-danger" disabled={busy || shown === null} onClick={() => { void restore(); }}>
          Restore and open
        </button>
        <button type="button" className="studio-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
