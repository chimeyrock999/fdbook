import type { RunSummary } from '../api/agents';
import { AgentLogo } from './AgentLogo';

// Over the open note while a run going on has written it: the agent wrote
// to disk, so the editor shows its text, and the diff shows what changed.
export function AgentWrote({ runs, path, onOpenDiff }: { runs: RunSummary[]; path: string; onOpenDiff: () => void }) {
  const run = runs.find((each) => each.writes.includes(path));
  if (run === undefined) return null;
  return (
    <div className="studio-agent-wrote" role="status">
      <AgentLogo id={run.agent} size={14} />
      <span>
        <strong>{run.agentName}</strong> changed this note in a run going on.
      </span>
      <button type="button" className="studio-button" onClick={onOpenDiff}>View diff</button>
    </div>
  );
}
