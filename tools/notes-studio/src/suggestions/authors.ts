import { AGENT_NAMES } from '../../server/agents/shared';
import type { ProposalAuthor } from '../../server/proposals/shared';

// An agent's name, or its id for one the Studio does not know.
export const agentName = (id: string) => (AGENT_NAMES as Partial<Record<string, string>>)[id] ?? id;

// Who made a proposal: the agent, or the person (`You` when the Studio has no sign-in).
export const authorName = ({ by }: { by: ProposalAuthor }) => (by.kind === 'run' ? agentName(by.agent) : (by.login ?? 'You'));
