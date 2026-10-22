import { History, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { AgentInfo, AgentRole } from '../api/agents';
import { AgentLogo } from './AgentLogo';
import { ChatHistory } from './ChatHistory';
import { Composer } from './Composer';
import { ConversationView } from './ConversationView';
import { roleLabel } from './transcript';
import { pickOf, type Agents } from './useAgents';

// Not a conversation id (server/agents/conversations.ts makes those of [a-z0-9-]).
const NEW_CHAT = ':new';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function hintOf(agent: AgentInfo | null, role: AgentRole) {
  if (agent === null) return 'No agent can run here: install one, then reload.';
  if (role === 'author') return 'An author may change files in this change request.';
  if (agent.fencesReviewer) return 'A reviewer reads only: it cannot change files.';
  return `${agent.name} cannot be held to reading: the Studio says no to the edits and commands it asks about, and lists any file it changes.`;
}

// A new chat: pick the role (the agent is the one picked for it), then the
// first message starts the conversation.
function NewChat({ agents, onStarted, onFailed }: { agents: Agents; onStarted: (id: string) => void; onFailed: (message: string) => void }) {
  const [role, setRole] = useState<AgentRole>('author');
  const agent = pickOf(agents.agents, agents.picks, role);
  return (
    <>
      <div className="studio-agent-empty">
        <strong>New chat</strong>
        <span>{hintOf(agent, role)}</span>
        <span>Agent and role stay the same for the whole chat: another agent or role is a new chat.</span>
      </div>
      <Composer
        placeholder={role === 'author' ? 'What should the agent write or change?' : 'What should the agent review?'}
        busy={agent === null}
        onSend={(text) => agents.start(role, text).then((started) => { onStarted(started.id); return true; }, (reason: unknown) => { onFailed(messageOf(reason)); return false; })}
      >
        <span className="studio-agent-roles" role="group" aria-label="Role">
          {(['author', 'reviewer'] as const).map((each) => (
            <button key={each} type="button" aria-pressed={role === each} onClick={() => { setRole(each); }}>{roleLabel(each)}</button>
          ))}
        </span>
        {agent !== null && <span className="studio-agent-who"><AgentLogo id={agent.id} size={14} /> {agent.name}</span>}
      </Composer>
    </>
  );
}

// The agent panel, at the right of the editor: a chat with an agent over
// many turns, a new chat, and the change request's earlier chats (History).
// Agents work only in a change request (`inCr`), and only for someone who
// may run them (`canRun`); others follow and read.
export function AgentPanel({ agents, inCr, canRun, onOpenDiff }: { agents: Agents; inCr: boolean; canRun: boolean; onOpenDiff: (path: string) => void }) {
  // NEW_CHAT: a new chat; null: the chat whose agent is answering, if any.
  const [shown, setShown] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const current = shown === NEW_CHAT ? null : (agents.conversations.find((conversation) => conversation.id === shown) ?? agents.conversations.find((conversation) => conversation.status === 'running') ?? null);
  const open = (id: string) => {
    setShown(id);
    setHistory(false);
    setFailed(null);
    void agents.load(id);
  };
  const error = failed ?? agents.error;

  return (
    <aside className="studio-agent-panel" aria-label="Agent">
      <header className="studio-agent-panel-head">
        <span>Agent</span>
        <span className="flex-1" />
        {inCr && (
          <button type="button" className="studio-button gap-1.5" aria-pressed={history} title="Chats in this change request" onClick={() => { setHistory(!history); }}>
            <History size={13} aria-hidden /> History
          </button>
        )}
        {inCr && canRun && (
          <button type="button" className="studio-button gap-1.5" onClick={() => { setShown(NEW_CHAT); setHistory(false); setFailed(null); requestAnimationFrame(() => { document.getElementById('studio-agent-prompt')?.focus(); }); }}>
            <Plus size={13} aria-hidden /> New chat
          </button>
        )}
        <button type="button" className="studio-icon-button" aria-label="Close the agent panel" title="Close" onClick={() => { agents.setPanel(false); }}><X size={15} /></button>
      </header>
      {error !== null && (
        <p role="alert" className="studio-tree-error studio-agent-panel-error">
          {error} <button type="button" className="studio-agent-link" onClick={() => { setFailed(null); agents.clearError(); }}>Dismiss</button>
        </p>
      )}
      {!inCr ? (
        <p className="studio-agent-meta studio-agent-panel-note">Agents work in a change request, never on main. Open one, or start a new one, to chat with an agent.</p>
      ) : history ? (
        <ChatHistory conversations={agents.conversations} current={current?.id ?? null} onOpen={open} onDelete={canRun ? (ids) => agents.remove(ids) : null} />
      ) : current !== null ? (
        <>
          <ConversationView
            conversation={current}
            events={agents.events[current.id]}
            onCancel={canRun ? () => { void agents.cancel(current.id); } : null}
            onOpenDiff={onOpenDiff}
          />
          {canRun && (
            <Composer
              key={current.id}
              placeholder="Reply to the agent…"
              busy={current.status === 'running'}
              onSend={(text) => agents.message(current.id, text).then(() => true, (reason: unknown) => { setFailed(messageOf(reason)); return false; })}
            >
              <span className="studio-agent-who"><AgentLogo id={current.agent} size={14} /> {current.agentName} · {roleLabel(current.role)}</span>
            </Composer>
          )}
        </>
      ) : canRun ? (
        <NewChat agents={agents} onStarted={(id) => { setShown(id); setFailed(null); }} onFailed={setFailed} />
      ) : (
        <p className="studio-agent-meta studio-agent-panel-note">Starting an agent needs admin access: it runs commands as the person who started the Studio, with their logins. You can read the chats in History.</p>
      )}
    </aside>
  );
}
