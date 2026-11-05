import { CircleUserRound } from 'lucide-react';
import type { AgentId } from '../../server/agents/shared';
import type { ThreadAuthor, ThreadSeverity, ThreadState } from '../api/proposals';
import { AgentLogo } from '../agents/AgentLogo';
import { nameOf, SEVERITY_LABELS, STATE_LABELS } from './texts';

// Who wrote: an agent's mark, name, model and role, or a person's name.
export function Who({ by, role = true }: { by: ThreadAuthor; role?: boolean }) {
  return (
    <span className="studio-review-who">
      {by.kind === 'run' ? <AgentLogo id={by.agent as AgentId} size={14} /> : <CircleUserRound size={14} aria-hidden />}
      <strong>{nameOf(by)}</strong>
      {by.kind === 'run' && by.model !== null && <span className="studio-review-model">{by.model}</span>}
      {role && by.kind === 'run' && <span className="studio-review-role">{by.role}</span>}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: ThreadSeverity | null }) {
  return severity === null ? null : <span className="studio-review-severity" data-severity={severity}>{SEVERITY_LABELS[severity]}</span>;
}

export function StateChip({ state }: { state: ThreadState }) {
  return <span className="studio-review-state" data-state={state}>{STATE_LABELS[state]}</span>;
}
