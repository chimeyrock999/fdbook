import { useEffect, useState } from 'react';
import { useBusy } from '../actions/busy';
import { PendingButton } from '../actions/PendingButton';
import { messageOf } from '../actions/toasts';
import type { DeletedRestore, HistoryClient } from '../api/history';
import { shortVersion } from './versions';

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
  // What the restore would write could not be read.
  const [error, setError] = useState<string | null>(null);
  const action = useBusy();
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
  // A failure says why in a toast.
  const restore = () => action.run(async () => {
    try {
      onDone(await client.restoreDeleted(path, sha));
    } catch (reason) {
      throw new Error(`Could not restore: ${messageOf(reason)}`, { cause: reason });
    }
  });
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
        <PendingButton className="studio-button studio-history-danger" pending={action.busy} pendingLabel="Restoring…" disabled={shown === null} onClick={() => { void restore(); }}>
          Restore and open
        </PendingButton>
        <button type="button" className="studio-button" disabled={action.busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
