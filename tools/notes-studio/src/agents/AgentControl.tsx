import { Bot, Check, ChevronDown } from 'lucide-react';
import { AGENT_ROLES } from '../../server/agents/shared';
import type { AgentInfo, AgentRole } from '../api/agents';
import { PopupMenu } from '../cr/PopupMenu';
import { useMenu } from '../cr/use-menu';
import { AgentLogo } from './AgentLogo';
import { pickOf, type Agents } from './useAgents';

const ROLE_LABELS: Record<AgentRole, { name: string; hint: string }> = {
  author: { name: 'Author', hint: 'may edit' },
  reviewer: { name: 'Reviewer', hint: 'read only' },
};

function AgentItem({ agent, checked, onPick }: { agent: AgentInfo; checked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} disabled={!agent.available} className="studio-agent-item" onClick={onPick}>
      <span className="studio-menu-check">{checked && <Check size={13} />}</span>
      <AgentLogo id={agent.id} />
      <span className="studio-agent-item-name">{agent.name}</span>
      {agent.version !== null && <span className="studio-agent-item-version">{agent.version}</span>}
      {agent.reason !== null && <span className="studio-agent-item-why">{agent.reason}</span>}
      {agent.note !== null && <span className="studio-agent-item-why" data-tone="warning">{agent.note}</span>}
    </button>
  );
}

// The header's agent control: a button that shows or hides the agent panel,
// with the number of agents answering, joined to the picker of the agent each
// role runs. Agents that cannot run here are listed, greyed, with why.
export function AgentControl({ agents, live }: { agents: Agents; live: number }) {
  const menu = useMenu();
  const author = pickOf(agents.agents, agents.picks, 'author');
  const reviewer = pickOf(agents.agents, agents.picks, 'reviewer');
  return (
    <div className="studio-agent-control">
      <button
        type="button"
        className="studio-agent-toggle"
        aria-pressed={agents.open}
        aria-label={agents.open ? 'Hide the agent panel' : 'Show the agent panel'}
        title={agents.open ? 'Hide the agent panel' : 'Show the agent panel'}
        onClick={() => { agents.setPanel(!agents.open); }}
      >
        <Bot size={15} aria-hidden />
        <span className="max-md:hidden">Agent</span>
        {live > 0 && <span className="studio-agent-count" aria-label={`${String(live)} running`}>{live}</span>}
      </button>
      <button
        type="button"
        className="studio-agent-picker"
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        aria-label={`Agents: ${author?.name ?? 'none'} writes, ${reviewer?.name ?? 'none'} reviews`}
        onClick={(event) => { menu.toggle(event.currentTarget); }}
      >
        {author === null ? <span>No agent</span> : (
          <>
            <AgentLogo id={author.id} size={14} />
            <span className="studio-agent-picker-name">{author.name}</span>
          </>
        )}
        {reviewer !== null && (
          <span className="studio-agent-picker-review max-lg:hidden">
            <span aria-hidden>·</span> review <AgentLogo id={reviewer.id} size={14} /> {reviewer.name}
          </span>
        )}
        <ChevronDown size={14} aria-hidden />
      </button>
      {menu.anchor !== null && (
        <PopupMenu anchor={menu.anchor} label="Agents" onClose={menu.close}>
          {agents.agents === null && <p className="studio-agent-menu-note">{agents.error ?? 'Looking for agents…'}</p>}
          {agents.agents !== null && AGENT_ROLES.map((role, index) => (
            <div key={role} role="group" aria-label={ROLE_LABELS[role].name} className="studio-agent-menu-group">
              {index > 0 && <hr />}
              <p className="studio-agent-menu-head"><span>{ROLE_LABELS[role].name}</span><span>{ROLE_LABELS[role].hint}</span></p>
              {agents.agents?.map((agent) => (
                <AgentItem
                  key={agent.id}
                  agent={agent}
                  checked={(role === 'author' ? author : reviewer)?.id === agent.id}
                  onPick={() => { agents.pick(role, agent.id); }}
                />
              ))}
            </div>
          ))}
          <hr />
          <p className="studio-agent-menu-note">Each agent signs in on its own; the Studio keeps no key. Choices are kept in this browser.</p>
        </PopupMenu>
      )}
    </div>
  );
}
