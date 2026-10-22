import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PERMISSION_TIMEOUT_MS, type PermissionAsk } from '../../server/agents/shared';
import type { RunSummary } from '../api/agents';
import { Dialog } from '../tree/TreeDialogs';
import { AgentLogo } from './AgentLogo';

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

// An agent's question before a tool call, with the options it gave (less
// "always", which the server drops). Closing the dialog rejects; so does
// the server once nobody answers in time.
export function PermissionDialog({ run, ask, at, onAnswer }: { run: RunSummary; ask: PermissionAsk; at: number; onAnswer: (optionId: string | null) => void }) {
  const left = useCountdown(at + PERMISSION_TIMEOUT_MS);
  const { command, paths } = detailsOf(ask);
  const allow = ask.options.find((option) => option.kind === 'allow_once');
  const title = `${run.agentName} asks: ${ask.toolCall.title ?? 'use a tool'}`;
  return (
    <Dialog title={title} onClose={() => { onAnswer(null); }} onSubmit={() => { onAnswer(allow?.optionId ?? null); }}>
      <p className="studio-agent-ask-lead">
        <AgentLogo id={run.agent} size={14} /> {run.role === 'author' ? 'Author' : 'Reviewer'} run. Nothing happens until you choose.
      </p>
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="studio-agent-meta mr-auto">Rejected in {left}</span>
        {ask.options.filter((option) => option !== allow).map((option) => (
          <button key={option.optionId} type="button" className="studio-button" onClick={() => { onAnswer(option.optionId); }}>{option.name}</button>
        ))}
        {allow !== undefined && <button type="submit" className="studio-button studio-button-primary">{allow.name}</button>}
      </div>
    </Dialog>
  );
}
