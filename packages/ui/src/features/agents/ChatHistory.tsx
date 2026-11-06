import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Spinner } from '#components/PendingButton.tsx';
import type { Conversation } from '#api/agents.ts';
import { AgentLogo } from './AgentLogo';
import { ConfirmPopover } from './ConfirmPopover';
import { TurnStatus } from './ConversationView';
import { costLabel, roleLabel, whenLabel } from './transcript';

type Confirming = { ids: string[]; anchor: HTMLElement };

// The change request's chats, last active first, filtered by their first
// message. One opens in the panel, to read and go on with. `onDelete` (an
// admin's) deletes one, or several picked with Select; a chat whose agent
// is answering is neither deleted nor picked. A chat being deleted shows it
// and waits: nothing else deletes it again.
export function ChatHistory({ conversations, current, onOpen, onDelete }: {
  conversations: Conversation[];
  current: string | null;
  onOpen: (id: string) => void;
  onDelete: ((ids: string[]) => Promise<void>) | null;
}) {
  const [filter, setFilter] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const shown = conversations.filter((conversation) => conversation.prompt.toLowerCase().includes(filter.trim().toLowerCase()));
  const pickedNow = [...picked].filter((id) => !deleting.has(id) && conversations.some((conversation) => conversation.id === id && conversation.status !== 'running'));

  const pick = (id: string, on: boolean) => {
    setPicked((before) => {
      const next = new Set(before);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const remove = (ids: string[]) => {
    setConfirming(null);
    if (onDelete === null) return;
    setDeleting((before) => new Set([...before, ...ids]));
    void onDelete(ids).finally(() => {
      setDeleting((before) => new Set([...before].filter((id) => !ids.includes(id))));
      if (ids.length > 1) stopSelecting();
    });
  };

  return (
    <section className="studio-agent-history" aria-label="Chats in this change request">
      <div className="studio-agent-history-tools">
        <input id="studio-agent-filter" type="search" aria-label="Filter chats" placeholder="Filter by first message…" value={filter} onChange={(event) => { setFilter(event.target.value); }} />
        {onDelete !== null && <button type="button" className="studio-button" aria-pressed={selecting} onClick={() => { if (selecting) stopSelecting(); else setSelecting(true); }}>Select</button>}
      </div>
      {conversations.length === 0 && <p className="studio-agent-meta studio-agent-history-empty">No chat yet.</p>}
      {conversations.length > 0 && shown.length === 0 && <p className="studio-agent-meta studio-agent-history-empty">No chat matches.</p>}
      <ul>
        {shown.map((conversation) => {
          const running = conversation.status === 'running';
          const gone = deleting.has(conversation.id);
          const cost = costLabel(conversation);
          return (
            <li key={conversation.id} className="studio-agent-history-row" data-selecting={selecting || undefined} data-busy={gone || undefined} aria-current={conversation.id === current || undefined}>
              {selecting && (
                <input
                  type="checkbox"
                  aria-label={`Pick: ${conversation.prompt}`}
                  checked={picked.has(conversation.id) && !running && !gone}
                  disabled={running || gone}
                  title={running ? 'The agent is answering' : undefined}
                  onChange={(event) => { pick(conversation.id, event.target.checked); }}
                />
              )}
              <button type="button" className="studio-agent-history-open" onClick={() => { if (selecting) pick(conversation.id, !picked.has(conversation.id)); else onOpen(conversation.id); }}>
                <span className="studio-agent-history-prompt">{conversation.prompt}</span>
                <span className="studio-agent-history-meta">
                  <span><AgentLogo id={conversation.agent} size={12} /> {conversation.agentName} · {roleLabel(conversation.role)}</span>
                  <span>{conversation.turns === 1 ? '1 turn' : `${String(conversation.turns)} turns`}</span>
                  {cost !== null && <span>{cost}</span>}
                  <span title={new Date(conversation.lastMs).toLocaleString()}>{whenLabel(conversation.lastMs)}</span>
                  {conversation.live && <span title="Its agent is up">● live</span>}
                </span>
              </button>
              <TurnStatus conversation={conversation} />
              {onDelete !== null && !selecting && (
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Delete: ${conversation.prompt}`}
                  title={running ? 'Cancel the turn first' : gone ? 'Deleting…' : 'Delete'}
                  disabled={running || gone}
                  aria-busy={gone || undefined}
                  onClick={(event) => { setConfirming({ ids: [conversation.id], anchor: event.currentTarget }); }}
                >
                  {gone ? <Spinner size={14} /> : <Trash2 size={14} />}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {selecting && (
        <div className="studio-agent-history-bulk">
          <span>{pickedNow.length} picked</span>
          <button type="button" className="studio-button" onClick={stopSelecting}>Done</button>
          <button
            type="button"
            className="studio-button studio-button-danger gap-1.5"
            disabled={pickedNow.length === 0}
            onClick={(event) => { setConfirming({ ids: pickedNow, anchor: event.currentTarget }); }}
          >
            <Trash2 size={12} aria-hidden /> {pickedNow.length === 1 ? 'Delete 1 chat' : `Delete ${String(pickedNow.length)} chats`}
          </button>
        </div>
      )}
      {confirming !== null && (
        <ConfirmPopover
          anchor={confirming.anchor}
          title={confirming.ids.length === 1 ? 'Delete this chat?' : `Delete ${String(confirming.ids.length)} chats?`}
          confirm="Delete"
          onConfirm={() => { remove(confirming.ids); }}
          onClose={() => { setConfirming(null); }}
        >
          {confirming.ids.length === 1 ? 'Its transcript goes from the Studio.' : 'Their transcripts go from the Studio.'} This cannot be undone.
        </ConfirmPopover>
      )}
    </section>
  );
}
