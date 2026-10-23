import { FilePen, FileText, Search, ShieldCheck, ShieldQuestion, ShieldX, Square, Terminal, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ToolCallUpdate } from '../../server/agents/shared';
import type { AgentsClient, RunEvent, RunSummary } from '../api/agents';
import { RunChanges } from './RunChanges';
import { AgentLogo } from './AgentLogo';
import { costLabel, durationLabel, transcriptOf, type TranscriptItem } from './transcript';

const STATUS_LABELS: Record<RunSummary['status'], string> = { running: 'Running', done: 'Done', cancelled: 'Cancelled', failed: 'Failed' };

export function RunStatus({ run }: { run: RunSummary }) {
  return <span className="studio-agent-status" data-status={run.status}>{STATUS_LABELS[run.status]}</span>;
}

function toolIcon(call: ToolCallUpdate): ReactNode {
  if (call.kind === 'read') return <FileText size={14} aria-hidden />;
  if (call.kind === 'edit' || call.kind === 'delete' || call.kind === 'move') return <FilePen size={14} aria-hidden />;
  if (call.kind === 'search' || call.kind === 'fetch') return <Search size={14} aria-hidden />;
  if (call.kind === 'execute') return <Terminal size={14} aria-hidden />;
  return <Wrench size={14} aria-hidden />;
}

const TOOL_STATES: Record<string, string> = { pending: 'Waiting', in_progress: 'Running', completed: 'Done', failed: 'Failed' };

function Item({ item, onOpenDiff, onOpenNote }: { item: TranscriptItem; onOpenDiff: (path: string) => void; onOpenNote: (path: string) => void }) {
  if (item.kind === 'message') return <p className="studio-agent-message">{item.text}</p>;
  if (item.kind === 'thought') return <p className="studio-agent-thought">{item.text}</p>;
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
  return (
    <div className="studio-agent-tool" data-status="wrote">
      <FilePen size={14} aria-hidden />
      <span className="studio-agent-tool-title" title={item.path}>{item.path}</span>
      <span className="studio-agent-tool-state">Wrote</span>
      <button type="button" className="studio-agent-link" onClick={() => { onOpenDiff(item.path); }}>View diff</button>
    </div>
  );
}

// One run: who ran it, what it said and did, and what it cost. `onCancel`
// is there while it runs and the viewer may stop it.
// `client` reads and decides the files the run changed itself (RunChanges),
// which `canDecide` allows.
export function RunView({ run, events, onCancel, onOpenDiff, onOpenNote, client, canDecide }: {
  run: RunSummary;
  events: RunEvent[] | undefined;
  onCancel: (() => void) | null;
  onOpenDiff: (path: string) => void;
  onOpenNote: (path: string) => void;
  client: AgentsClient;
  canDecide: boolean;
}) {
  const items = events === undefined ? null : transcriptOf(events);
  const cost = costLabel(run);
  return (
    <section className="studio-agent-run" aria-label={`Run of ${run.agentName}`}>
      <header className="studio-agent-run-head">
        <AgentLogo id={run.agent} />
        <strong>{run.agentName}</strong>
        <span className="studio-agent-role">{run.role === 'author' ? 'Author' : 'Reviewer'}</span>
        {run.model !== null && <span className="studio-agent-meta">{run.model}</span>}
        <span className="flex-1" />
        {run.status === 'running' && onCancel !== null ? (
          <button type="button" className="studio-button gap-1.5" onClick={onCancel}><Square size={12} aria-hidden /> Cancel</button>
        ) : <RunStatus run={run} />}
      </header>
      <div className="studio-agent-stream">
        <p className="studio-agent-prompt">{run.prompt}</p>
        {items === null && <p className="studio-agent-meta">Loading the transcript…</p>}
        {items?.map((item) => <Item key={item.key} item={item} onOpenDiff={onOpenDiff} onOpenNote={onOpenNote} />)}
        {run.error !== null && <p role="alert" className="studio-tree-error">{run.error}</p>}
        <RunChanges client={client} run={run} canDecide={canDecide} />
      </div>
      <footer className="studio-agent-run-foot">
        <span>{durationLabel(run)}</span>
        <span>{cost ?? 'Cost not reported'}</span>
        {run.writes.length > 0 && <span>{run.writes.length === 1 ? '1 file written' : `${String(run.writes.length)} files written`}</span>}
        {run.by !== null && <span>by {run.by}</span>}
      </footer>
    </section>
  );
}
