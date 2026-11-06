import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { crSlug } from '@fdbook/shared/cr-slug.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import { messageOf } from '#components/toasts.ts';
import type { ChangeRequest, CrClient, Discard } from '#api/crs.ts';
import { Dialog } from '#components/Dialog.tsx';
import { isDone, plural } from './cr-status';

// A new change request: its name, and the branch it will get. The server
// fetches origin/main and adds the worktree, which can take a few seconds.
// Once created, the page loads the new change request: the button stays
// busy until it goes. A failure says why in a toast.
export function NewCrDialog({ client, taken, onCreated, onClose }: {
  client: CrClient;
  // The slugs in use, so the branch shown is the one the server picks.
  taken: readonly string[];
  onCreated: (cr: ChangeRequest) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const action = useBusy();
  const [created, setCreated] = useState(false);
  const busy = action.busy || created;
  const slug = crSlug(name, new Set(taken));

  const submit = () => {
    if (slug === null || busy) return;
    void action.run(async () => {
      const cr = await client.create(name);
      setCreated(true);
      onCreated(cr);
    });
  };

  return (
    <Dialog title="New change request" busy={busy} onClose={onClose} onSubmit={submit}>
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">A new branch from origin/main, fetched now. What you have open opens in it.</p>
      <label className="grid gap-1">
        <span className="studio-field-label">Name</span>
        <input className="studio-input" autoFocus value={name} disabled={busy} onChange={(event) => { setName(event.target.value); }} />
        <span className="studio-cr-hint">{slug === null ? 'The name needs a letter or a digit.' : `Branch cr/${slug}`}</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-primary" pending={busy} pendingLabel="Creating…" disabled={slug === null}>Create</PendingButton>
      </div>
    </Dialog>
  );
}

// Asks before a change request is discarded, or cleaned up once merged or
// closed, listing what goes (a dry run on the server): from origin, the open
// pull request and the branch; from this machine, the worktree and the local
// branch. The one being worked in can go too: the Studio then goes back to
// main.
export function DiscardDialog({ client, cr, current, onDone, onClose }: {
  client: CrClient;
  cr: ChangeRequest;
  current: boolean;
  onDone: (discard: Discard) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<Discard | null>(null);
  const action = useBusy();
  const [done, setDone] = useState(false);
  const busy = action.busy || done;
  // The dry run could not be read: the dialog has nothing else to show.
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client.discard(cr.slug, true).then(
      (answer) => { if (current) setPlan(answer); },
      (reason: unknown) => { if (current) setFailed(messageOf(reason)); },
    );
    return () => { current = false; };
  }, [client, cr.slug]);

  // A refused discard (origin changed since the dry run, say) says why in
  // a toast and checks again, so the dialog lists what a new try would do.
  // Once done, the dialog stays busy until the page moves on (onDone).
  const submit = () => {
    if (plan === null || busy || plan.prError !== null) return;
    void action.run(async () => {
      try {
        const discard = await client.discard(cr.slug, false, { pushed: plan.pushed, closesPr: plan.closesPr?.number ?? null });
        setDone(true);
        onDone(discard);
      } catch (reason) {
        setPlan(null);
        await client.discard(cr.slug, true).then(setPlan, (again: unknown) => { setFailed(messageOf(again)); });
        throw reason;
      }
    });
  };

  // The dry run read origin and the pull request just now; the list may be older.
  const status = plan?.status ?? cr.status;
  const cleanUp = isDone({ status });
  const known = plan?.pr ?? cr.pr;
  const pr = known === null ? 'The pull request' : `Pull request #${String(known.number)}`;
  const lead = status === 'merged' ? `${pr} was merged. Its changes are on main.` : status === 'closed' ? `${pr} was closed without merging.` : 'This cannot be undone.';
  const verb = cleanUp ? 'Clean up' : 'Discard';

  return (
    <Dialog title={`${verb} “${cr.name}”?`} busy={busy} onClose={onClose} onSubmit={submit}>
      {current && (
        <p className="studio-cr-inside">
          <Info size={15} aria-hidden /> You are working in this change request. Studio goes back to main afterwards.
        </p>
      )}
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">{lead}</p>
      {plan === null && (failed === null || busy) && <p role="status" className="studio-tree-status">Checking what it removes…</p>}
      {plan !== null && (
        <>
          <h3 className="studio-cr-from" id="studio-cr-from-here">From this machine</h3>
          <ul className="studio-cr-lost" aria-labelledby="studio-cr-from-here">
            {plan.worktree !== null && <li>Worktree <code>{plan.worktree}</code></li>}
            <li>Local branch <code>{plan.branch}</code>{plan.commits > 0 && ` (${plural(plan.commits, 'commit')})`}</li>
            {plan.uncommitted > 0 && <li>{plural(plan.uncommitted, 'file')} with changes not committed</li>}
          </ul>
          <h3 className="studio-cr-from" id="studio-cr-from-origin">From origin</h3>
          {plan.pushed || plan.closesPr !== null ? (
            <ul className="studio-cr-lost" aria-labelledby="studio-cr-from-origin">
              {plan.closesPr !== null && <li>Pull request #{plan.closesPr.number} is closed, not merged</li>}
              {plan.pushed && <li>Branch <code>{plan.branch}</code></li>}
              {plan.pushed && cr.previewUrl !== null && !cleanUp && <li>Its preview stops updating; Cloudflare keeps the last build</li>}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[var(--fde-muted-foreground)]">{status === 'draft' ? 'Never pushed: nothing to remove there.' : 'The branch is already gone from origin.'}</p>
          )}
          {plan.unpushed > 0 && <p className="studio-cr-warning">{plural(plan.unpushed, 'commit')} never pushed: lost with the local branch.</p>}
          {plan.prError !== null && (
            <p role="alert" className="studio-tree-error">
              Pull requests could not be read ({plan.prError}). A pull request of this branch would close without notice, so it cannot be {cleanUp ? 'cleaned up' : 'discarded'} until gh works again.
            </p>
          )}
        </>
      )}
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className={`studio-button ${cleanUp ? 'studio-button-primary' : 'studio-button-danger'}`} pending={busy} pendingLabel={cleanUp ? 'Cleaning up…' : 'Discarding…'} disabled={plan?.prError !== null}>
          {verb}
        </PendingButton>
      </div>
    </Dialog>
  );
}
