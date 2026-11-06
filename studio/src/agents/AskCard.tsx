import { ShieldCheck, ShieldQuestion, ShieldX, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PERMISSION_TIMEOUT_MS, type PermissionAsk } from '../../server/agents/shared';
import { useBusy } from '../actions/busy';
import { PendingButton } from '../actions/PendingButton';
import type { Conversation } from '../api/agents';

type Answer = { optionId: string | null; by: string | null };

// What the tool call would run or touch, as far as the agent says.
function detailsOf(ask: PermissionAsk) {
  const input = ask.toolCall.rawInput;
  const command = typeof input === 'object' && input !== null && 'command' in input ? input.command : null;
  return {
    command: typeof command === 'string' ? command : Array.isArray(command) ? command.join(' ') : null,
    paths: ask.toolCall.locations?.map((location) => location.path) ?? [],
  };
}

function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(timer); };
  }, []);
  const seconds = Math.max(0, Math.round((until - now) / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

// A question in the thread, on one line: waiting, or what was answered and by whom.
export function AskLine({ ask, answer }: { ask: PermissionAsk; answer: Answer | null }) {
  const picked = answer === null ? null : ask.options.find((option) => option.optionId === answer.optionId);
  const allowed = picked?.kind.startsWith('allow') === true;
  return (
    <div className="studio-agent-tool" data-status={answer === null ? 'asking' : allowed ? 'completed' : 'failed'}>
      {answer === null ? <ShieldQuestion size={14} aria-hidden /> : allowed ? <ShieldCheck size={14} aria-hidden /> : <ShieldX size={14} aria-hidden />}
      <span className="studio-agent-tool-title">{ask.toolCall.title ?? 'Permission'}</span>
      <span className="studio-agent-tool-state">
        {answer === null ? 'Waiting for you' : `${picked?.name ?? 'Rejected'}${answer.by === null ? (picked ? '' : ': no answer') : ` by ${answer.by}`}`}
      </span>
    </div>
  );
}

// An agent's question before a tool call, in its chat (#138: no dialog
// over the page), with the options it gave (less "always", which the server
// drops). Nothing happens until one is picked; the server rejects once
// nobody answers in time. Once the server has the answer, the card is a
// line, before the stream says so.
export function AskCard({ conversation, ask, at, onAnswer }: { conversation: Conversation; ask: PermissionAsk; at: number; onAnswer: (optionId: string) => Promise<void> }) {
  const left = useCountdown(at + PERMISSION_TIMEOUT_MS);
  const action = useBusy();
  const [answered, setAnswered] = useState<string | null>(null);
  if (answered !== null) return <AskLine ask={ask} answer={{ optionId: answered, by: null }} />;
  const { command, paths } = detailsOf(ask);
  const allow = ask.options.find((option) => option.kind === 'allow_once');
  const title = `${conversation.agentName} asks: ${ask.toolCall.title ?? 'use a tool'}`;
  const pick = (optionId: string) => {
    void action.run(async () => {
      await onAnswer(optionId);
      setAnswered(optionId);
    }, optionId);
  };
  // The allowing option last, as the main button.
  const options = allow === undefined ? ask.options : [...ask.options.filter((option) => option !== allow), allow];
  return (
    <section className="studio-agent-ask" aria-label={title}>
      <p className="studio-agent-ask-head"><ShieldQuestion size={14} aria-hidden /> {title}</p>
      {command !== null && <pre className="studio-agent-ask-command">{command}</pre>}
      {paths.length > 0 && (
        <ul className="studio-agent-ask-paths">
          {paths.map((path) => <li key={path}><code>{path}</code></li>)}
        </ul>
      )}
      {ask.toolCall.kind === 'execute' && (
        <p className="studio-agent-ask-warning">
          <TriangleAlert size={14} aria-hidden /> Commands run as you on this machine, in the change request&rsquo;s worktree.
        </p>
      )}
      <div className="studio-agent-ask-options">
        <span className="studio-agent-meta mr-auto">Rejected in {left}</span>
        {options.map((option) => (
          <PendingButton
            key={option.optionId}
            className={option === allow ? 'studio-button studio-button-primary' : 'studio-button'}
            pending={action.is(option.optionId)}
            pendingLabel={option.kind.startsWith('allow') ? 'Allowing…' : 'Rejecting…'}
            disabled={action.busy}
            onClick={() => { pick(option.optionId); }}
          >
            {option.name}
          </PendingButton>
        ))}
      </div>
    </section>
  );
}
