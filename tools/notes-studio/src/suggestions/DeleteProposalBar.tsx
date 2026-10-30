import { Trash2 } from 'lucide-react';
import type { AgentId } from '../../server/agents/shared';
import { useBusy } from '../actions/busy';
import { PendingButton } from '../actions/PendingButton';
import { AgentLogo } from '../agents/AgentLogo';
import type { DeleteProposalView } from '../api/proposals';
import { authorName } from './authors';

// What the editor shows of a delete an agent proposed for the open note (or
// its folder): who, why, and Review delete… (the delete dialog, with its
// dry run) or Reject. A reader sees it without the actions. `waiting`: the
// note has edits not on disk yet, which the delete would drop: Review waits.
export type NoteDeletion = { proposal: DeleteProposalView; waiting: boolean; onReview: () => void; onReject: () => Promise<void> };

export function DeleteProposalBar({ deletion, readOnly }: { deletion: NoteDeletion; readOnly: boolean }) {
  const { proposal } = deletion;
  const action = useBusy();
  const folder = !proposal.path.endsWith('.mdx');
  return (
    <div className="studio-suggest-bar" data-kind="delete" role="region" aria-label="Proposed delete">
      <span className="studio-suggest-who">
        <Trash2 size={14} className="text-[var(--fde-error)]" aria-hidden />
        {proposal.by.kind === 'run' && <AgentLogo id={proposal.by.agent as AgentId} size={14} />}
        <strong>{authorName(proposal)}</strong> proposes deleting {folder ? <>the folder <code>{proposal.path}</code></> : 'this page'}
      </span>
      {proposal.summary !== null && <span className="studio-suggest-summary" title={proposal.summary}>{proposal.summary}</span>}
      {!readOnly && (
        <span className="ml-auto flex gap-2">
          <PendingButton className="studio-button" pending={action.busy} pendingLabel="Rejecting…" onClick={() => { void action.run(deletion.onReject); }}>Reject</PendingButton>
          <button type="button" className="studio-button studio-button-danger" disabled={action.busy || deletion.waiting} onClick={deletion.onReview}>Review delete…</button>
        </span>
      )}
      {!readOnly && deletion.waiting && <span className="studio-suggest-summary">The note has unsaved changes. Review the delete once it shows Saved.</span>}
    </div>
  );
}
