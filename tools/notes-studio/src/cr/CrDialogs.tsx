import { useEffect, useState } from 'react';
import { crSlug } from '../../server/cr/slug';
import type { ChangeRequest, CrClient, Discard } from '../api/crs';
import { Dialog } from '../tree/TreeDialogs';
import { plural } from './cr-status';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// A new change request: its name, and the branch it will get. The server
// fetches origin/main and adds the worktree, which can take a few seconds.
export function NewCrDialog({ client, taken, onCreated, onClose }: {
  client: CrClient;
  // The slugs in use, so the branch shown is the one the server picks.
  taken: readonly string[];
  onCreated: (cr: ChangeRequest) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const slug = crSlug(name, new Set(taken));

  const submit = () => {
    if (slug === null || busy) return;
    setBusy(true);
    client.create(name).then(onCreated, (reason: unknown) => {
      setBusy(false);
      setFailed(messageOf(reason));
    });
  };

  return (
    <Dialog title="New change request" onClose={onClose} onSubmit={submit}>
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">A new branch from origin/main, fetched now. What you have open opens in it.</p>
      <label className="grid gap-1">
        <span className="studio-field-label">Name</span>
        <input className="studio-input" autoFocus value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setFailed(null); }} />
        <span className="studio-cr-hint">{slug === null ? 'The name needs a letter or a digit.' : `Branch cr/${slug}`}</span>
      </label>
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-button studio-button-primary" disabled={slug === null || busy}>{busy ? 'Creating…' : 'Create'}</button>
      </div>
    </Dialog>
  );
}

// Asks before a change request is discarded, listing what goes from this
// machine (a dry run on the server). A pushed branch and its pull request
// stay on the remote.
export function DiscardDialog({ client, cr, onDone, onClose }: {
  client: CrClient;
  cr: ChangeRequest;
  onDone: (discard: Discard) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<Discard | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client.discard(cr.slug, true).then(
      (answer) => { if (current) setPlan(answer); },
      (reason: unknown) => { if (current) setFailed(messageOf(reason)); },
    );
    return () => { current = false; };
  }, [client, cr.slug]);

  const submit = () => {
    if (plan === null || busy) return;
    setBusy(true);
    client.discard(cr.slug).then(onDone, (reason: unknown) => {
      setBusy(false);
      setFailed(messageOf(reason));
    });
  };

  return (
    <Dialog title={`Discard “${cr.name}”?`} onClose={onClose} onSubmit={submit}>
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">This cannot be undone. It removes from this machine:</p>
      {plan === null && failed === null && <p role="status" className="studio-tree-status">Checking what it removes…</p>}
      {plan !== null && (
        <ul className="studio-cr-lost" aria-label="Removed">
          {plan.worktree !== null && <li>Worktree <code>{plan.worktree}</code></li>}
          <li>Local branch <code>{plan.branch}</code>{plan.commits > 0 && ` (${plural(plan.commits, 'commit')})`}</li>
          {plan.uncommitted > 0 && <li>{plural(plan.uncommitted, 'file')} with changes not committed</li>}
        </ul>
      )}
      {plan?.pushed && (
        <p className="studio-cr-warning">
          The branch is on origin. The remote branch{plan.pr ? `, pull request #${String(plan.pr.number)}` : ''} and its preview stay there.
        </p>
      )}
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-button studio-button-danger" disabled={plan === null || busy}>{busy ? 'Discarding…' : 'Discard'}</button>
      </div>
    </Dialog>
  );
}
