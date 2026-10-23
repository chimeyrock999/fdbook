import { FilePen, FileText, Search, Square, Terminal, Wrench } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ToolCallUpdate } from '../../server/agents/shared';
import { PendingButton, Spinner } from '../actions/PendingButton';
import type { AgentsClient, Conversation, ConversationEvent } from '../api/agents';
import { AgentLogo } from './AgentLogo';
import { AskCard, AskLine } from './AskCard';
import { ContextChips } from './ContextChips';
import { Markdown } from './Markdown';
import { TurnChanges } from './TurnChanges';
import { costLabel, decisionKey, durationLabel, roleLabel, transcriptOf, whenLabel, type TranscriptItem } from './transcript';

const STATUS_LABELS: Record<Conversation['status'], string> = { running: 'Running', done: 'Done', cancelled: 'Cancelled', failed: 'Failed' };

export function TurnStatus({ conversation }: { conversation: Pick<Conversation, 'status'> }) {
  return <span className="studio-agent-status" data-status={conversation.status}>{STATUS_LABELS[conversation.status]}</span>;
}

function toolIcon(call: ToolCallUpdate): ReactNode {
  if (call.kind === 'read') return <FileText size={14} aria-hidden />;
  if (call.kind === 'edit' || call.kind === 'delete' || call.kind === 'move') return <FilePen size={14} aria-hidden />;
  if (call.kind === 'search' || call.kind === 'fetch') return <Search size={14} aria-hidden />;
  if (call.kind === 'execute') return <Terminal size={14} aria-hidden />;
  return <Wrench size={14} aria-hidden />;
}

const TOOL_STATES: Record<string, string> = { pending: 'Waiting', in_progress: 'Running', completed: 'Done', failed: 'Failed' };
const TURN_ENDS: Record<string, string> = { done: '', cancelled: 'cancelled', failed: 'failed' };

// What an item needs besides itself: the conversation, the panel's
// actions, and the client and right to keep or revert a turn's changes.
type ItemContext = {
  conversation: Conversation;
  onOpenDiff: (path: string) => void;
  onOpenNote: (path: string) => void;
  client: AgentsClient;
  canDecide: boolean;
  // Keep/Revert decisions per turn (`decisionKey`), from the stream.
  decisions: Record<string, number>;
  // Answers a question of the agent's; null for a viewer who may not.
  onAnswer: ((ask: string, optionId: string) => Promise<void>) | null;
};

function Item({ item, context }: { item: TranscriptItem; context: ItemContext }) {
  const { conversation, onOpenDiff, onOpenNote } = context;
  const agentName = conversation.agentName;
  if (item.kind === 'prompt') {
    return (
      <>
        <p className="studio-agent-prompt">{item.text}</p>
        {item.context !== null && <ContextChips context={item.context} />}
        <span className="studio-agent-prompt-meta">{item.by === null ? '' : `${item.by} · `}{whenLabel(item.at)}</span>
      </>
    );
  }
  if (item.kind === 'message') return <Markdown text={item.text} className="studio-agent-message" />;
  if (item.kind === 'thought') return <Markdown text={item.text} className="studio-agent-thought" />;
  if (item.kind === 'session') {
    return item.how === 'fresh'
      ? <p className="studio-agent-marker" data-tone="warning">{agentName} could not pick the session up again: a new one, without the earlier turns</p>
      : <p className="studio-agent-marker">{agentName} picked the session up again</p>;
  }
  if (item.kind === 'turn-end') {
    const cost = costLabel(item.turn);
    const parts = [`Turn ${String(item.index)}`, TURN_ENDS[item.turn.status], durationLabel(item.ms), cost].filter((part) => part !== null && part !== '');
    return (
      <>
        {item.turn.error !== null && <p role="alert" className="studio-tree-error">{item.turn.error}</p>}
        <span className="studio-agent-turn-foot">{parts.join(' · ')}</span>
        <TurnChanges client={context.client} id={conversation.id} turn={item.index} writes={item.turn.writes ?? []} version={context.decisions[decisionKey(conversation.id, item.index)] ?? 0} canDecide={context.canDecide} />
      </>
    );
  }
  if (item.kind === 'proposal') {
    return (
      <div className="studio-agent-tool" data-status="proposal">
        <FilePen size={14} aria-hidden />
        <span className="studio-agent-tool-title" title={item.path}>{item.path}</span>
        <span className="studio-agent-tool-state">{item.hunks === 1 ? '1 suggestion' : `${String(item.hunks)} suggestions`}</span>
        <button type="button" className="studio-agent-link" onClick={() => { onOpenNote(item.path); }}>Review in editor</button>
      </div>
    );
  }
  if (item.kind === 'plan') {
    return (
      <ol className="studio-agent-plan" aria-label="Plan">
        {item.entries.map((entry, index) => <li key={index} data-status={entry.status}>{entry.content}</li>)}
      </ol>
    );
  }
  if (item.kind === 'tool') {
    return (
      <div className="studio-agent-tool" data-status={item.call.status ?? 'pending'}>
        {toolIcon(item.call)}
        <span className="studio-agent-tool-title" title={item.call.title ?? undefined}>{item.call.title ?? item.call.name ?? 'Tool call'}</span>
        <span className="studio-agent-tool-state">{TOOL_STATES[item.call.status ?? 'pending']}</span>
      </div>
    );
  }
  if (item.kind === 'ask') {
    const { onAnswer } = context;
    if (item.answer === null && onAnswer !== null && conversation.status === 'running') {
      return <AskCard conversation={conversation} ask={item.ask} at={item.at} onAnswer={(optionId) => onAnswer(item.ask.id, optionId)} />;
    }
    return <AskLine ask={item.ask} answer={item.answer} />;
  }
  return (
    <div className="studio-agent-tool" data-status="wrote">
      <FilePen size={14} aria-hidden />
      <span className="studio-agent-tool-title" title={item.path}>{item.path}</span>
      <span className="studio-agent-tool-state">Wrote</span>
      <button type="button" className="studio-agent-link" onClick={() => { onOpenDiff(item.path); }}>View diff</button>
    </div>
  );
}

// How close to the bottom counts as following the thread.
const FOLLOW_PX = 48;

// One conversation: who it is with, on one line (the model cut short with
// its full name as a title, so the status stays on that line), and every
// turn. The thread follows new text while it is scrolled to the bottom,
// and goes down to a new question of the agent's. `onCancel` is there while
// a turn runs and the viewer may stop it (`cancelling`: asked to, until the
// turn ends). `sending`: a message on its way, shown before the stream
// brings it. Until the agent says or does anything after the last message,
// the thread says it is thinking.
// `client` reads and decides the files each turn changed (TurnChanges),
// which `canDecide` allows; `onAnswer` answers its questions.
export function ConversationView({ conversation, events, onCancel, cancelling, sending, onAnswer, onOpenDiff, onOpenNote, client, canDecide, decisions }: {
  conversation: Conversation;
  events: ConversationEvent[] | undefined;
  onCancel: (() => void) | null;
  cancelling: boolean;
  sending: string | null;
  onAnswer: ((ask: string, optionId: string) => Promise<void>) | null;
  onOpenDiff: (path: string) => void;
  onOpenNote: (path: string) => void;
  client: AgentsClient;
  canDecide: boolean;
  decisions: Record<string, number>;
}) {
  const context: ItemContext = { conversation, onOpenDiff, onOpenNote, client, canDecide, decisions, onAnswer };
  const items = events === undefined ? null : transcriptOf(events);
  const running = conversation.status === 'running';
  const asking = items?.filter((item) => item.kind === 'ask' && item.answer === null).at(-1)?.key ?? null;
  const thinking = running && asking === null && (sending !== null || items?.at(-1)?.kind === 'prompt');
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const shownAsk = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (asking !== shownAsk.current) {
      shownAsk.current = asking;
      if (asking !== null) following.current = true;
    }
    const element = thread.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  });
  return (
    <section className="studio-agent-conversation" aria-label={`Chat with ${conversation.agentName}`}>
      <header className="studio-agent-conversation-head">
        <AgentLogo id={conversation.agent} />
        <strong>{conversation.agentName}</strong>
        <span className="studio-agent-role">{roleLabel(conversation.role)}</span>
        {conversation.model !== null && <span className="studio-agent-model" title={conversation.model}>{conversation.model}</span>}
        <span className="studio-agent-grow" />
        {running && onCancel !== null ? (
          <PendingButton className="studio-button gap-1.5" pending={cancelling} pendingLabel="Cancelling…" onClick={onCancel}><Square size={12} aria-hidden /> Cancel</PendingButton>
        ) : <TurnStatus conversation={conversation} />}
      </header>
      <div
        ref={thread}
        className="studio-agent-thread"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
        }}
      >
        {items === null && sending === null && <p className="studio-agent-meta">Loading the chat…</p>}
        {items?.map((item) => <Item key={item.key} item={item} context={context} />)}
        {sending !== null && <Sending text={sending} />}
        {thinking && <Thinking name={conversation.agentName} />}
      </div>
    </section>
  );
}

// A message on its way to the agent.
export function Sending({ text }: { text: string }) {
  return (
    <>
      <p className="studio-agent-prompt" data-pending>{text}</p>
      <span className="studio-agent-prompt-meta" role="status"><Spinner size={11} /> Sending…</span>
    </>
  );
}

export function Thinking({ name, doing = 'is thinking' }: { name: string; doing?: string }) {
  return (
    <p className="studio-agent-thinking" role="status">
      {name} {doing}<span className="studio-agent-dots" aria-hidden><span /><span /><span /></span>
    </p>
  );
}
