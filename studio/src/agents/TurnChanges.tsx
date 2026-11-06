import { useEffect, useState } from 'react';
import { useBusy } from '../actions/busy';
import { PendingButton } from '../actions/PendingButton';
import type { AgentsClient, TurnChange } from '../api/agents';
import { SourceDiff } from '../diff/SourceDiff';

// Which turn of which conversation.
type Of = { id: string; turn: number };

// One file the turn changed with the agent's own tools: its diff from
// before the turn (opened on demand), and Keep or Revert.
function Change({ client, of, change, canDecide, onDecided }: { client: AgentsClient; of: Of; change: TurnChange; canDecide: boolean; onDecided: (change: TurnChange) => void }) {
  const [diff, setDiff] = useState<{ before: string | null; after: string | null } | null>(null);
  const action = useBusy();
  // The diff could not be read (a decision's failure is a toast).
  const [failed, setFailed] = useState<string | null>(null);
  const toggleDiff = () => {
    if (diff !== null) {
      setDiff(null);
      return;
    }
    client.compare(of.id, of.turn, change.path).then(setDiff, (reason: unknown) => { setFailed((reason as Error).message); });
  };
  const decide = (op: 'keep' | 'revert') => {
    void action.run(async () => { onDecided(await client.decide(of.id, of.turn, change.path, op)); }, op);
  };
  const viewDiff = <button type="button" className="studio-agent-link" aria-expanded={diff !== null} onClick={toggleDiff}>{diff === null ? 'View diff' : 'Hide diff'}</button>;
  return (
    <li className="studio-agent-change">
      <span className="studio-agent-change-path" title={change.path}>
        {change.path}
        {!change.existed && <span className="studio-suggest-chip">new</span>}
      </span>
      <span className="studio-agent-change-row">
        {change.decided !== null ? (
          <span className="studio-suggest-chip">{change.decided === 'kept' ? 'Kept' : 'Reverted'}</span>
        ) : change.reason !== null ? (
          <>
            {/* Its earlier version is kept (a person saved it too): still readable. */}
            {change.existed && viewDiff}
            <span className="studio-agent-meta">{change.reason}</span>
          </>
        ) : (
          <>
            {viewDiff}
            <span className="flex-1" />
            {canDecide && (
              <>
                <PendingButton className="studio-button" pending={action.is('keep')} pendingLabel="Keeping…" disabled={action.busy} onClick={() => { decide('keep'); }}>Keep</PendingButton>
                <PendingButton className="studio-button" data-tone="error" pending={action.is('revert')} pendingLabel={change.existed ? 'Reverting…' : 'Deleting…'} disabled={action.busy} onClick={() => { decide('revert'); }}>{change.existed ? 'Revert' : 'Delete'}</PendingButton>
              </>
            )}
          </>
        )}
      </span>
      {failed !== null && <span role="alert" className="studio-tree-error">{failed}</span>}
      {diff !== null && <div className="studio-agent-change-diff"><SourceDiff path={change.path} before={diff.before ?? ''} after={diff.after ?? ''} /></div>}
    </li>
  );
}

// The files an ended turn changed itself (or wrote through the Studio
// outside a proposal), to keep or put back as they were when it began.
// `writes`: the files its end listed. `version` grows with each decision
// made on another page, and the list is read again.
export function TurnChanges({ client, id, turn, writes, version, canDecide }: { client: AgentsClient; id: string; turn: number; writes: string[]; version: number; canDecide: boolean }) {
  const [changes, setChanges] = useState<TurnChange[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = writes.length > 0;
  useEffect(() => {
    if (!ready) return undefined;
    let current = true;
    client.changes(id, turn).then(
      (list) => { if (current) setChanges(list); },
      (reason: unknown) => { if (current) setFailed((reason as Error).message); },
    );
    return () => { current = false; };
  }, [client, id, turn, ready, version]);
  if (!ready || (changes !== null && changes.length === 0)) return null;
  return (
    <section className="studio-agent-changes" aria-label="Files this turn changed">
      <h4>Files this turn changed</h4>
      <p className="studio-agent-meta">Keep each change, or put the file back as it was when the turn began.</p>
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      {changes === null && failed === null && <p className="studio-agent-meta">Loading…</p>}
      <ul>
        {changes?.map((change) => (
          <Change
            key={change.path}
            client={client}
            of={{ id, turn }}
            change={change}
            canDecide={canDecide}
            onDecided={(next) => { setChanges((list) => list?.map((each) => (each.path === next.path ? next : each)) ?? null); }}
          />
        ))}
      </ul>
    </section>
  );
}
