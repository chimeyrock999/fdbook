import { Play, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { AgentInfo, AgentRole } from '../api/agents';
import { AgentLogo } from './AgentLogo';
import { RunStatus, RunView } from './RunView';
import { costLabel, durationLabel } from './transcript';
import { pickOf, type Agents } from './useAgents';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function hintOf(agent: AgentInfo | null, role: AgentRole) {
  if (agent === null) return 'No agent can run here: install one, then reload.';
  if (role === 'author') return 'An author may change files in this change request.';
  if (agent.fencesReviewer) return 'A reviewer reads only: it cannot change files.';
  return `${agent.name} cannot be held to reading: the Studio says no to the edits and commands it asks about, and lists any file it changes.`;
}

function Composer({ agents, onStarted }: { agents: Agents; onStarted: (id: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [role, setRole] = useState<AgentRole>('author');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const agent = pickOf(agents.agents, agents.picks, role);

  const run = () => {
    if (busy || prompt.trim() === '' || agent === null) return;
    setBusy(true);
    setFailed(null);
    agents.start(role, prompt).then(
      (started) => {
        setPrompt('');
        onStarted(started.id);
      },
      (reason: unknown) => { setFailed(messageOf(reason)); },
    ).finally(() => { setBusy(false); });
  };

  return (
    <form className="studio-agent-composer" onSubmit={(event) => { event.preventDefault(); run(); }}>
      <textarea
        id="studio-agent-prompt"
        aria-label="Prompt"
        placeholder={role === 'author' ? 'What should the agent write or change?' : 'What should the agent review?'}
        value={prompt}
        onChange={(event) => { setPrompt(event.target.value); }}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); run(); } }}
      />
      <div className="studio-agent-composer-row">
        <span className="studio-agent-roles" role="group" aria-label="Role">
          {(['author', 'reviewer'] as const).map((each) => (
            <button key={each} type="button" aria-pressed={role === each} onClick={() => { setRole(each); }}>{each === 'author' ? 'Author' : 'Reviewer'}</button>
          ))}
        </span>
        {agent !== null && <span className="studio-agent-who"><AgentLogo id={agent.id} size={14} /> {agent.name}</span>}
        <span className="flex-1" />
        <button type="submit" className="studio-button studio-button-primary gap-1.5" disabled={busy || prompt.trim() === '' || agent === null}>
          <Play size={12} aria-hidden /> Run
        </button>
      </div>
      <p className="studio-agent-meta">{hintOf(agent, role)}</p>
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
    </form>
  );
}

// The agent panel, at the right of the editor: start a run, follow it, and
// go back to the change request's earlier runs. Agents run only in a change
// request (`inCr`), and only for someone who may write (`canRun`).
export function AgentPanel({ agents, inCr, canRun, onOpenDiff }: { agents: Agents; inCr: boolean; canRun: boolean; onOpenDiff: (path: string) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const current = agents.runs.find((run) => run.id === shown) ?? agents.runs.find((run) => run.status === 'running') ?? null;
  const open = (id: string) => {
    setShown(id);
    void agents.load(id);
  };

  return (
    <aside className="studio-agent-panel" aria-label="Agent">
      <header className="studio-agent-panel-head">
        <span>Agent</span>
        <span className="flex-1" />
        {inCr && canRun && <button type="button" className="studio-button gap-1.5" onClick={() => { setShown(null); document.getElementById('studio-agent-prompt')?.focus(); }}><Plus size={13} aria-hidden /> New run</button>}
        <button type="button" className="studio-icon-button" aria-label="Close the agent panel" title="Close" onClick={() => { agents.setPanel(false); }}><X size={15} /></button>
      </header>
      <div className="studio-agent-panel-body">
        {!inCr ? (
          <p className="studio-agent-meta">Agents run in a change request, never on main. Open one, or start a new one, to run an agent.</p>
        ) : (
          <>
            {canRun ? <Composer agents={agents} onStarted={open} /> : (
              <p className="studio-agent-meta">Starting an agent needs admin access: it runs commands as the person who started the Studio, with their logins. You can follow the runs here.</p>
            )}
            {agents.error !== null && (
              <p role="alert" className="studio-tree-error">
                {agents.error} <button type="button" className="studio-agent-link" onClick={agents.clearError}>Dismiss</button>
              </p>
            )}
            {current !== null && (
              <RunView
                run={current}
                events={agents.events[current.id]}
                onCancel={canRun ? () => { void agents.cancel(current.id); } : null}
                onOpenDiff={onOpenDiff}
              />
            )}
            <section className="studio-agent-history" aria-label="Runs in this change request">
              <h3>Runs in this change request</h3>
              {agents.runs.length === 0 && <p className="studio-agent-meta">No run yet.</p>}
              <ul>
                {agents.runs.map((run) => (
                  <li key={run.id}>
                    <button type="button" aria-current={run.id === current?.id || undefined} onClick={() => { open(run.id); }}>
                      <span className="studio-agent-history-prompt">{run.prompt}</span>
                      <RunStatus run={run} />
                      <span className="studio-agent-history-meta">
                        <span><AgentLogo id={run.agent} size={12} /> {run.agentName} · {run.role === 'author' ? 'Author' : 'Reviewer'}</span>
                        <span>{costLabel(run) ?? '—'}</span>
                        <span>{durationLabel(run)}</span>
                        <span title={new Date(run.startedMs).toLocaleString()}>{new Date(run.startedMs).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
