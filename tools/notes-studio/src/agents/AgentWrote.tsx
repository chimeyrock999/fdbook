import type { Conversation } from '../api/agents';
import { AgentLogo } from './AgentLogo';

// Over the open note while a chat whose agent is answering has written it:
// the agent wrote to disk, so the editor shows its text, and the diff shows
// what changed.
export function AgentWrote({ conversations, path, onOpenDiff }: { conversations: Conversation[]; path: string; onOpenDiff: () => void }) {
  const conversation = conversations.find((each) => each.writes.includes(path));
  if (conversation === undefined) return null;
  return (
    <div className="studio-agent-wrote" role="status">
      <AgentLogo id={conversation.agent} size={14} />
      <span>
        <strong>{conversation.agentName}</strong> changed this note in a chat going on.
      </span>
      <button type="button" className="studio-button" onClick={onOpenDiff}>View diff</button>
    </div>
  );
}
