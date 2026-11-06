import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useBusy } from '#actions/busy.ts';
import { PendingButton } from '#actions/PendingButton.tsx';
import { CHANGED_SINCE } from '@fdbook/shared/tree.ts';
import { isConflict } from '#api/json.ts';
import type { DeleteProposalView } from '#api/proposals.ts';
import type { TreeAnswer, TreeClient } from '#api/tree.ts';
import { authorName } from '#suggestions/authors.ts';
import { renamedPath } from './tree';
import { Changes, Dialog } from './TreeDialogs';

// What a delete takes: a page `x.mdx`, a folder page `x/index.mdx` or a
// folder `x`, relative to content/notes.
export type DeleteTarget = { path: string; title: string; folder: boolean };

type Plan = { answer: TreeAnswer | null; error: string | null };

const GROUPS = [
  { type: 'delete', label: 'Deleted' },
  { type: 'change', label: 'Changed' },
  { type: 'keep', label: 'Kept' },
] as const;

// Asks before a delete, showing its dry run: the files that go, the
// meta.yaml entries taken out, the images kept because another note uses
// them, and the notes whose links will break. The delete sends the dry
// run's base back, so it takes only what was shown; when something changed
// since, the list is read again and the person asked to look again. With a
// `proposal` (an agent's propose_delete), it says who proposed it and why,
// Delete accepts it (`onAccept`) and it can be rejected.
export function DeleteDialog({ client, target, unsaved = null, proposal = null, onAccept, onReject, onDone, onClose }: {
  client: TreeClient;
  target: DeleteTarget;
  // The open note while it has edits not on disk yet: deleting it (or its
  // folder) would drop them, so the delete waits, as a rename does.
  unsaved?: string | null;
  proposal?: DeleteProposalView | null;
  onAccept?: (base: string) => Promise<void>;
  onReject?: () => Promise<void>;
  onDone: (answer: TreeAnswer) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [changed, setChanged] = useState(false);
  const action = useBusy();

  const load = useCallback(() => client.change({ op: 'delete', path: target.path }, true).then(
    (answer) => { setPlan({ answer, error: null }); },
    (reason: unknown) => { setPlan({ answer: null, error: reason instanceof Error ? reason.message : String(reason) }); },
  ), [client, target.path]);
  useEffect(() => { void load(); }, [load]);

  const base = plan?.answer?.base ?? null;
  const waiting = unsaved !== null && renamedPath(unsaved, target.path, target.path) !== null;
  const submit = () => {
    if (base === null || waiting) return;
    void action.run(async () => {
      try {
        // An accepted proposal deletes on the server what the dry run showed.
        if (proposal !== null && onAccept && plan?.answer) {
          await onAccept(base);
          onDone(plan.answer);
        } else onDone(await client.change({ op: 'delete', path: target.path, base }));
      } catch (reason) {
        // Only a delete whose files changed reads the list again; any other
        // refusal (a proposal decided meanwhile) says why in a toast.
        if (!isConflict(reason) || !(reason as Error).message.startsWith(CHANGED_SINCE)) throw reason;
        setChanged(true);
        setPlan(null);
        await load();
      }
    }, 'delete');
  };
  const reject = () => {
    if (!onReject) return;
    void action.run(async () => {
      await onReject();
      onClose();
    }, 'reject');
  };

  const changes = plan?.answer?.changes ?? [];
  const links = plan?.answer?.links ?? [];
  return (
    <Dialog title={target.folder ? `Delete folder “${target.title}”?` : `Delete “${target.title}”?`} busy={action.busy} onClose={onClose} onSubmit={submit}>
      {proposal !== null && (
        <p className="studio-delete-by">
          <strong>{authorName(proposal)}</strong> proposed this delete{proposal.summary === null ? '.' : `: “${proposal.summary}”`}
        </p>
      )}
      <p className="text-[12.5px] text-[var(--fde-muted-foreground)]">
        {target.folder ? 'Every page in the folder goes, with the images only these pages use.' : 'The page goes, with the images only it uses.'}
        {' '}Restore {target.folder ? 'its pages' : 'it'} from Deleted pages.
      </p>
      {changed && <p role="status" className="studio-tree-error">The notes changed since this list was made. Check the new list and delete again.</p>}
      {plan === null && <p className="studio-diff-note">Reading what the delete takes…</p>}
      {plan?.error != null && <p role="alert" className="studio-tree-error">{plan.error}</p>}
      {GROUPS.map(({ type, label }) => {
        const shown = changes.filter((change) => change.type === type);
        return shown.length === 0 ? null : (
          <div key={type} className="grid gap-1">
            <span className="studio-field-label">{label}</span>
            <Changes changes={shown} />
          </div>
        );
      })}
      {links.length > 0 && (
        <div className="studio-delete-links" role="group" aria-label="Links that will break">
          <strong>{links.length === 1 ? '1 link still reaches it.' : `${String(links.length)} links still reach it.`}</strong> They will break; lint shows them.
          <ul>
            {links.map((link) => <li key={`${link.note}:${String(link.line)}:${link.href}`}>{link.note}:{link.line} <span>{link.href}</span></li>)}
          </ul>
        </div>
      )}
      {waiting && <p role="status" className="studio-tree-error">The open note has unsaved changes. Delete once it shows Saved.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {proposal !== null && onReject && (
          <PendingButton className="studio-button mr-auto" pending={action.is('reject')} pendingLabel="Rejecting…" disabled={action.busy} onClick={reject}>Reject proposal</PendingButton>
        )}
        <button type="button" className="studio-button" disabled={action.busy} onClick={onClose}>Cancel</button>
        <PendingButton type="submit" className="studio-button studio-button-danger" pending={action.is('delete')} pendingLabel="Deleting…" disabled={base === null || waiting}>
          <Trash2 size={13} aria-hidden /> {target.folder ? 'Delete folder' : 'Delete'}
        </PendingButton>
      </div>
    </Dialog>
  );
}
