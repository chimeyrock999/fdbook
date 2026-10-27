import { FilePlus, History, Plus, ShieldQuestion, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBusy } from '../actions/busy';
import { toast } from '../actions/toasts';
import type { AgentInfo, AgentRole, Conversation, ConversationEvent, MessageContext } from '../api/agents';
import { NOTE_ACTIONS } from './actions';
import { askPending, takeAsks } from './agent-ask';
import { AgentLogo } from './AgentLogo';
import { ChatHistory } from './ChatHistory';
import { Composer, type Draft } from './Composer';
import { ConversationView, Sending, Thinking } from './ConversationView';
import { editorPlaces } from './editor-place';
import { NewNote } from './NewNote';
import { roleLabel } from './transcript';
import { pickOf, type Agents } from './useAgents';

// Not a conversation id (server/agents/conversations.ts makes those of [a-z0-9-]).
const NEW_CHAT = ':new';

// A message on its way: in its chat (null: the new chat it starts), shown
// until the stream brings it, i.e. until the chat has more than `turns` turns.
type Outgoing = { id: string | null; text: string; turns: number };

const turnsOf = (events: ConversationEvent[] | undefined) => events?.filter((event) => event.type === 'turn').length ?? 0;

function hintOf(agent: AgentInfo | null, role: AgentRole) {
  if (agent === null) return 'No agent can run here: install one, then reload.';
  if (role === 'author') return 'An author may change files in this change request.';
  if (agent.fencesReviewer) return 'A reviewer reads only: it cannot change files.';
  return `${agent.name} cannot be held to reading: the Studio says no to the edits and commands it asks about, and lists any file it changes.`;
}

// A new chat: pick the role (the agent is the one picked for it), then the
// first message starts the conversation. While the agent starts, the
// message shows on its way.
function NewChat({ agents, sending, onSend, onAction }: {
  agents: Agents;
  sending: string | null;
  onSend: (role: AgentRole, text: string, context: MessageContext | null) => Promise<boolean>;
  onAction: (prompt: string, context: MessageContext | null, draft: Draft) => Promise<boolean>;
}) {
  const [role, setRole] = useState<AgentRole>('author');
  const agent = pickOf(agents.agents, agents.picks, role);
  return (
    <>
      {sending !== null && agent !== null ? (
        <div className="studio-agent-thread">
          <Sending text={sending} />
          <Thinking name={agent.name} doing="is starting" />
        </div>
      ) : (
        <div className="studio-agent-empty">
          <strong>New chat</strong>
          <span>{hintOf(agent, role)}</span>
          <span>Agent and role stay the same for the whole chat: another agent or role is a new chat.</span>
        </div>
      )}
      <Composer
        placeholder={role === 'author' ? 'What should the agent write or change?' : 'What should the agent review?'}
        busy={agent === null}
        onSend={(text, context) => onSend(role, text, context)}
        client={agents.client}
        actions={role === 'author' && agent !== null}
        onAction={onAction}
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
// may run them (`canRun`); others follow and read. `canDecide`: may keep
// or revert what a turn changed (a writer). `asking`: the chat whose agent
// waits for an answer (App), shown unless another one was opened; then a
// strip says so.
export function AgentPanel({ agents, inCr, canRun, canDecide, asking, onOpenDiff, onOpenNote }: {
  agents: Agents;
  inCr: boolean;
  canRun: boolean;
  canDecide: boolean;
  asking: Conversation | null;
  onOpenDiff: (path: string) => void;
  onOpenNote: (path: string) => void;
}) {
  // NEW_CHAT: a new chat; null: the chat whose agent asks or is answering, if any.
  const [shown, setShown] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  // The new note's form is open (#86).
  const [drafting, setDrafting] = useState(false);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  // The chat this panel just started, as the server answered, until the
  // stream lists it (then the list has it, deleted or not).
  const [started, setStarted] = useState<Conversation | null>(null);
  if (started !== null && agents.conversations.some((conversation) => conversation.id === started.id)) setStarted(null);
  // The chats asked to stop, each with the turn it was at: its Cancel
  // waits for that turn's end. The ref holds before React renders.
  const [stopping, setStopping] = useState<ReadonlyMap<string, number>>(new Map());
  const asked = useRef(new Set<string>());
  const listed = agents.conversations.find((conversation) => conversation.id === shown) ?? (started?.id === shown ? started : undefined);
  const current = shown === NEW_CHAT ? null : (listed ?? asking ?? agents.conversations.find((conversation) => conversation.status === 'running') ?? null);
  const open = (id: string) => {
    setShown(id);
    setHistory(false);
    void agents.load(id);
  };
  const askingElsewhere = asking !== null && (history || asking.id !== current?.id) ? asking : null;
  const pendingIn = (conversation: Conversation) =>
    (outgoing !== null && outgoing.id === conversation.id && turnsOf(agents.events[conversation.id]) <= outgoing.turns ? outgoing.text : null);

  // `draft`: what the composer held, for the new chat's (an action's).
  const start = async (role: AgentRole, text: string, context: MessageContext | null, draft: Draft | null = null) => {
    setOutgoing({ id: null, text, turns: 0 });
    try {
      const chat = await agents.start(role, text, context);
      setOutgoing({ id: chat.id, text, turns: 0 });
      setStarted(chat);
      setCarried(draft === null ? null : { id: chat.id, draft });
      setShown(chat.id);
      // Read it should the stream have missed its start.
      void agents.load(chat.id);
      return true;
    } catch (reason) {
      setOutgoing(null);
      toast.error(reason);
      return false;
    }
  };
  const reply = async (conversation: Conversation, text: string, context: MessageContext | null) => {
    setOutgoing({ id: conversation.id, text, turns: turnsOf(agents.events[conversation.id]) });
    try {
      await agents.message(conversation.id, text, context);
      return true;
    } catch (reason) {
      setOutgoing(null);
      toast.error(reason);
      return false;
    }
  };
  // The message being written an action left for a new chat: that chat's
  // composer starts with it, chips too.
  const [carried, setCarried] = useState<{ id: string; draft: Draft } | null>(null);
  // An action (actions.ts) goes to the author chat on screen while it waits
  // for a message (none on its way to it either), else to a new author chat.
  const act = (prompt: string, context: MessageContext | null, draft: Draft | null = null) => {
    setDrafting(false);
    if (current !== null && current.role === 'author' && current.status !== 'running' && pendingIn(current) === null) return reply(current, prompt, context);
    return start('author', prompt, context, draft);
  };
  // The note header's asks (agent-ask.ts), on the note open now; one at a time.
  const latestAct = useRef(act);
  useLayoutEffect(() => { latestAct.current = act; });
  const { run: runAsk, running: askRunning } = useBusy();
  useEffect(() => { askPending(askRunning); }, [askRunning]);
  const author = pickOf(agents.agents, agents.picks, 'author') !== null;
  useEffect(() => {
    if (!inCr || !canRun || !author) return undefined;
    return takeAsks((actionId) => {
      const wanted = NOTE_ACTIONS.find((each) => each.id === actionId);
      const place = editorPlaces.get();
      if (wanted === undefined || place === null) return;
      setHistory(false);
      void runAsk(() => latestAct.current(wanted.prompt, { note: place.note, selection: null, caret: null, mentions: [], attachments: [] }), actionId);
    });
  }, [inCr, canRun, author, runAsk]);
  const stop = (conversation: Conversation) => {
    const { id, turns } = conversation;
    const key = `${id}@${String(turns)}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    setStopping((before) => new Map(before).set(id, turns));
    agents.cancel(id).catch((reason: unknown) => {
      asked.current.delete(key);
      setStopping((before) => {
        const next = new Map(before);
        next.delete(id);
        return next;
      });
      toast.error(reason);
    });
  };

  return (
    <aside className="studio-agent-panel" aria-label="Agent">
      {/* New note and New chat are icons: with their labels the header is wider than the panel (#161). */}
      <header className="studio-agent-panel-head">
        <span>Agent</span>
        <span className="flex-1" />
        {inCr && (
          <button type="button" className="studio-button gap-1.5" aria-pressed={history} title="Chats in this change request" onClick={() => { setHistory(!history); setDrafting(false); }}>
            <History size={13} aria-hidden /> History
          </button>
        )}
        {inCr && canRun && (
          <button type="button" className="studio-button px-[7px]" aria-pressed={drafting} aria-label="New note" title="New note" onClick={() => { setDrafting(!drafting); setHistory(false); }}>
            <FilePlus size={13} aria-hidden />
          </button>
        )}
        {inCr && canRun && (
          <button type="button" className="studio-button px-[7px]" aria-label="New chat" title="New chat" onClick={() => { setShown(NEW_CHAT); setHistory(false); setDrafting(false); requestAnimationFrame(() => { document.getElementById('studio-agent-prompt')?.focus(); }); }}>
            <Plus size={13} aria-hidden />
          </button>
        )}
        <button type="button" className="studio-icon-button" aria-label="Close the agent panel" title="Close" onClick={() => { agents.setPanel(false); }}><X size={15} /></button>
      </header>
      {askingElsewhere !== null && (
        <p role="status" className="studio-agent-strip">
          <ShieldQuestion size={14} aria-hidden />
          <span>{askingElsewhere.agentName} is asking in another chat</span>
          <button type="button" className="studio-agent-link" onClick={() => { open(askingElsewhere.id); }}>Show</button>
        </p>
      )}
      {!inCr ? (
        <p className="studio-agent-meta studio-agent-panel-note">Agents work in a change request, never on main. Open one, or start a new one, to chat with an agent.</p>
      ) : drafting && canRun ? (
        <NewNote client={agents.client} onDraft={(prompt, context) => start('author', prompt, context)} onClose={() => { setDrafting(false); }} />
      ) : history ? (
        <ChatHistory conversations={agents.conversations} current={current?.id ?? null} onOpen={open} onDelete={canRun ? (ids) => agents.remove(ids) : null} />
      ) : current !== null ? (
        <>
          <ConversationView
            conversation={current}
            events={agents.events[current.id]}
            onCancel={canRun ? () => { stop(current); } : null}
            cancelling={stopping.get(current.id) === current.turns}
            sending={pendingIn(current)}
            onAnswer={canRun ? (ask, optionId) => agents.answer(current.id, ask, optionId) : null}
            onOpenDiff={onOpenDiff}
            onOpenNote={onOpenNote}
            client={agents.client}
            canDecide={canDecide}
            decisions={agents.decisions}
          />
          {canRun && (
            <Composer
              key={current.id}
              placeholder="Reply to the agent…"
              busy={current.status === 'running'}
              onSend={(text, context) => reply(current, text, context)}
              client={agents.client}
              actions={current.role === 'author'}
              onAction={act}
              initial={carried?.id === current.id ? carried.draft : null}
            >
              <span className="studio-agent-who"><AgentLogo id={current.agent} size={14} /> {current.agentName} · {roleLabel(current.role)}</span>
            </Composer>
          )}
        </>
      ) : canRun ? (
        <NewChat agents={agents} sending={outgoing?.id === null ? outgoing.text : null} onSend={start} onAction={act} />
      ) : (
        <p className="studio-agent-meta studio-agent-panel-note">Starting an agent needs admin access: it runs commands as the person who started the Studio, with their logins. You can read the chats in History.</p>
      )}
    </aside>
  );
}
