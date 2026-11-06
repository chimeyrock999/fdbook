import { MessageSquarePlus, Play, Unlink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isOpen, THREAD_SEVERITIES, THREAD_STATES } from '@fdbook/shared/review.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import type { Conversation } from '#api/agents.ts';
import type { Thread, ThreadSeverity } from '#api/proposals.ts';
import { NOTES_PREFIX } from '#lib/note-paths.ts';
import type { Agents } from '#agents/useAgents.ts';
import { pickOf } from '#agents/useAgents.ts';
import { SeverityChip, StateChip, Who } from './labels';
import { blockingCount, nameOf, openerOf, REVIEW_PROMPT, SEVERITY_LABELS, STATE_LABELS } from './texts';
import { Composer } from './ThreadMarks';

// The filters of the list: all, or one value each.
type Filter = { state: 'unresolved' | 'all' | Thread['state']; severity: 'all' | ThreadSeverity | 'comment'; author: string; note: string };
const ALL: Filter = { state: 'unresolved', severity: 'all', author: 'all', note: 'all' };

const authorKey = (thread: Thread) => {
  const by = openerOf(thread);
  return by.kind === 'run' ? `agent:${by.agent}` : `person:${by.login ?? ''}`;
};
const shown = (filter: Filter) => (thread: Thread) =>
  (filter.state === 'all' || (filter.state === 'unresolved' ? isOpen(thread) : thread.state === filter.state))
  && (filter.severity === 'all' || (thread.severity ?? 'comment') === filter.severity)
  && (filter.author === 'all' || authorKey(thread) === filter.author)
  && (filter.note === 'all' || thread.path === filter.note);

const noteName = (path: string) => path.startsWith(NOTES_PREFIX) ? path.slice(NOTES_PREFIX.length) : path;

// Review this CR: the reviewer agent picked, and the chat it runs in.
function ReviewRun({ agents }: { agents: Agents }) {
  const action = useBusy();
  const [chat, setChat] = useState<string | null>(null);
  const ready = agents.agents?.filter((agent) => agent.available) ?? [];
  const reviewer = pickOf(agents.agents, agents.picks, 'reviewer');
  const running: Conversation | undefined = agents.conversations.find((conversation) => conversation.id === chat);
  if (running?.status === 'running') {
    return (
      <div className="studio-review-run" role="status">
        <span className="studio-review-running">{running.agentName} is reviewing…</span>
        <button type="button" className="studio-button" onClick={() => { agents.setPanel(true); }}>Open chat</button>
      </div>
    );
  }
  return (
    <div className="studio-review-run">
      <p className="studio-review-actions">
        <select className="studio-input studio-review-select" aria-label="Reviewer agent" value={reviewer?.id ?? ''} disabled={ready.length === 0} onChange={(event) => { const found = ready.find((agent) => agent.id === event.target.value); if (found) agents.pick('reviewer', found.id); }}>
          {ready.length === 0 && <option value="">No agent can run</option>}
          {ready.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <PendingButton
          className="studio-button studio-button-primary"
          pending={action.busy}
          pendingLabel="Starting…"
          disabled={reviewer === null}
          onClick={() => { void action.run(async () => { setChat((await agents.start('reviewer', REVIEW_PROMPT)).id); }); }}
        >
          <Play size={12} aria-hidden /> Review this CR
        </PendingButton>
      </p>
      <p className="studio-review-hint">
        {running !== undefined ? `${running.agentName} finished: its threads are below.` : 'Reads the diff against main and the style guide, then comments here. It changes nothing.'}
      </p>
    </div>
  );
}

// The Review view (#87): every thread of the change request, filtered by
// state, severity, author and note; one picked opens its note at its block.
// Review this CR for someone who may run agents; Comment on the note for a
// writer with a note open.
export function ReviewPanel({ threads, activeNote, readOnly, agents, onPick, onOpenThread }: {
  threads: Thread[];
  activeNote: string | null;
  readOnly: boolean;
  agents: Agents | null;
  onPick: (thread: Thread) => void;
  onOpenThread: (path: string, body: string, severity: ThreadSeverity | null) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>(ALL);
  const [writing, setWriting] = useState(false);
  const notes = useMemo(() => [...new Set(threads.map((thread) => thread.path))].sort(), [threads]);
  const authors = useMemo(() => new Map(threads.map((thread) => [authorKey(thread), nameOf(openerOf(thread))])), [threads]);
  const list = threads.filter(shown(filter));
  const groups = notes.map((note) => [note, list.filter((thread) => thread.path === note)] as const).filter(([, each]) => each.length > 0);
  const set = (key: keyof Filter) => (event: { target: { value: string } }) => { setFilter({ ...filter, [key]: event.target.value }); };
  const waiting = threads.filter((thread) => thread.state === 'needs-decision').length;
  return (
    <section aria-label="Review" className="studio-review-panel">
      {agents !== null && <ReviewRun agents={agents} />}
      {!readOnly && activeNote !== null && (writing
        ? <Composer label={`Comment on ${noteName(activeNote)}`} onCancel={() => { setWriting(false); }} onSubmit={async (body, severity) => { await onOpenThread(activeNote, body, severity); setWriting(false); }} />
        : <button type="button" className="studio-add" onClick={() => { setWriting(true); }}><MessageSquarePlus size={12} aria-hidden /> Comment on the note</button>)}
      <div className="studio-review-filters">
        <select className="studio-input studio-review-select" aria-label="State" value={filter.state} onChange={set('state')}>
          <option value="unresolved">Not resolved</option>
          <option value="all">Any state</option>
          {THREAD_STATES.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
        </select>
        <select className="studio-input studio-review-select" aria-label="Severity" value={filter.severity} onChange={set('severity')}>
          <option value="all">Any severity</option>
          {[...THREAD_SEVERITIES, 'comment' as const].map((severity) => <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>)}
        </select>
        <select className="studio-input studio-review-select" aria-label="Author" value={filter.author} onChange={set('author')}>
          <option value="all">Anyone</option>
          {[...authors].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <select className="studio-input studio-review-select" aria-label="Note" value={filter.note} onChange={set('note')}>
          <option value="all">All notes</option>
          {notes.map((note) => <option key={note} value={note}>{noteName(note)}</option>)}
        </select>
      </div>
      <p className="studio-review-summary">
        <span><strong data-severity="blocking">{blockingCount(threads)}</strong> blocking</span>
        {waiting > 0 && <span>{waiting} {waiting === 1 ? 'needs' : 'need'} your decision</span>}
        <span>{list.length} shown</span>
      </p>
      {groups.length === 0 ? (
        <p className="studio-review-empty">{threads.length === 0 ? 'No review threads yet. Comment on a block from the format bubble, or ask an agent to review.' : 'No thread matches these filters.'}</p>
      ) : groups.map(([note, each]) => (
        <div key={note} className="studio-review-group">
          <h3>{noteName(note)}</h3>
          <ul>
            {each.map((thread) => (
              <li key={thread.id}>
                <button type="button" className="studio-review-item" onClick={() => { onPick(thread); }}>
                  <span className="studio-review-line">
                    <Who by={openerOf(thread)} role={false} />
                    <SeverityChip severity={thread.severity} />
                    <StateChip state={thread.state} />
                    {thread.orphaned && <span className="studio-review-orphan"><Unlink size={11} aria-hidden /> Block gone</span>}
                    {thread.comments.length > 1 && <span className="studio-review-model">{thread.comments.length - 1} more</span>}
                  </span>
                  <span className="studio-review-item-body">{thread.comments[0].body}</span>
                  {thread.anchor !== null && <span className="studio-review-item-quote">{thread.anchor.text.split('\n')[0]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
