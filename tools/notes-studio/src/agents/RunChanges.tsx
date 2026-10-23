import { useEffect, useState } from 'react';
import type { AgentsClient, RunChange, RunSummary } from '../api/agents';
import { SourceDiff } from '../diff/SourceDiff';

// One file the run changed with its own tools: its diff from before the run
// (opened on demand), and Keep or Revert.
function Change({ client, run, change, canDecide, onDecided }: { client: AgentsClient; run: RunSummary; change: RunChange; canDecide: boolean; onDecided: (change: RunChange) => void }) {
  const [diff, setDiff] = useState<{ before: string | null; after: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const toggleDiff = () => {
    if (diff !== null) {
      setDiff(null);
      return;
    }
    client.compare(run.id, change.path).then(setDiff, (reason: unknown) => { setFailed((reason as Error).message); });
  };
  const decide = (op: 'keep' | 'revert') => {
    setBusy(true);
    setFailed(null);
    client.decide(run.id, change.path, op).then(onDecided, (reason: unknown) => { setFailed((reason as Error).message); }).finally(() => { setBusy(false); });
  };
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
          <span className="studio-agent-meta">{change.reason}</span>
        ) : (
          <>
            <button type="button" className="studio-agent-link" aria-expanded={diff !== null} onClick={toggleDiff}>{diff === null ? 'View diff' : 'Hide diff'}</button>
            <span className="flex-1" />
            {canDecide && (
              <>
                <button type="button" className="studio-button" disabled={busy} onClick={() => { decide('keep'); }}>Keep</button>
                <button type="button" className="studio-button" data-tone="error" disabled={busy} onClick={() => { decide('revert'); }}>{change.existed ? 'Revert' : 'Delete'}</button>
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

// The files an ended run changed itself (or wrote through the Studio
// outside a proposal), to keep or put back as they were when it started.
export function RunChanges({ client, run, canDecide }: { client: AgentsClient; run: RunSummary; canDecide: boolean }) {
  const [changes, setChanges] = useState<RunChange[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = run.status !== 'running' && run.writes.length > 0;
  useEffect(() => {
    if (!ready) return undefined;
    let current = true;
    client.changes(run.id).then(
      (list) => { if (current) setChanges(list); },
      (reason: unknown) => { if (current) setFailed((reason as Error).message); },
    );
    return () => { current = false; };
  }, [client, run.id, ready]);
  if (!ready || (changes !== null && changes.length === 0)) return null;
  return (
    <section className="studio-agent-changes" aria-label="Changed outside the Studio">
      <h4>Changed outside the Studio</h4>
      <p className="studio-agent-meta">Keep each change, or put the file back as it was when the run started.</p>
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      {changes === null && failed === null && <p className="studio-agent-meta">Loading…</p>}
      <ul>
        {changes?.map((change) => (
          <Change
            key={change.path}
            client={client}
            run={run}
            change={change}
            canDecide={canDecide}
            onDecided={(next) => { setChanges((list) => list?.map((each) => (each.path === next.path ? next : each)) ?? null); }}
          />
        ))}
      </ul>
    </section>
  );
}
