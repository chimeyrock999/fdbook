import { FilePen, FileText, Search, ShieldCheck, ShieldQuestion, ShieldX, Square, Terminal, Wrench } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ToolCallUpdate } from '../../server/agents/shared';
import type { Conversation, ConversationEvent } from '../api/agents';
import { AgentLogo } from './AgentLogo';
import { Markdown } from './Markdown';
import { costLabel, durationLabel, roleLabel, transcriptOf, whenLabel, type TranscriptItem } from './transcript';

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

function Item({ item, agentName, onOpenDiff }: { item: TranscriptItem; agentName: string; onOpenDiff: (path: string) => void }) {
  if (item.kind === 'prompt') {
    return (
      <>
        <p className="studio-agent-prompt">{item.text}</p>
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
      </>
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
    const picked = item.answer === null ? null : item.ask.options.find((option) => option.optionId === item.answer?.optionId);
    const allowed = picked?.kind.startsWith('allow') === true;
    return (
      <div className="studio-agent-tool" data-status={item.answer === null ? 'asking' : allowed ? 'completed' : 'failed'}>
        {item.answer === null ? <ShieldQuestion size={14} aria-hidden /> : allowed ? <ShieldCheck size={14} aria-hidden /> : <ShieldX size={14} aria-hidden />}
        <span className="studio-agent-tool-title">{item.ask.toolCall.title ?? 'Permission'}</span>
        <span className="studio-agent-tool-state">
          {item.answer === null ? 'Waiting for you' : `${picked?.name ?? 'Rejected'}${item.answer.by === null ? (picked ? '' : ': no answer') : ` by ${item.answer.by}`}`}
        </span>
      </div>
    );
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
// turn. The thread follows new text while it is scrolled to the bottom.
// `onCancel` is there while a turn runs and the viewer may stop it.
export function ConversationView({ conversation, events, onCancel, onOpenDiff }: {
  conversation: Conversation;
  events: ConversationEvent[] | undefined;
  onCancel: (() => void) | null;
  onOpenDiff: (path: string) => void;
}) {
  const items = events === undefined ? null : transcriptOf(events);
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
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
        {conversation.status === 'running' && onCancel !== null ? (
          <button type="button" className="studio-button gap-1.5" onClick={onCancel}><Square size={12} aria-hidden /> Cancel</button>
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
        {items === null && <p className="studio-agent-meta">Loading the chat…</p>}
        {items?.map((item) => <Item key={item.key} item={item} agentName={conversation.agentName} onOpenDiff={onOpenDiff} />)}
      </div>
    </section>
  );
}
