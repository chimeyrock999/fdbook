import { useCallback, useEffect, useState } from 'react';
import type { AgentId, AgentInfo, AgentRole, AgentsClient } from '../api/agents';
import { EMPTY_RUNS, withEvent, withList, type RunsState } from './transcript';

const PICKS_KEY = 'notes-studio:agents';
const PANEL_KEY = 'notes-studio:agent-panel';

export type Picks = Record<AgentRole, AgentId | null>;

function readPicks(): Picks {
  try {
    const value = JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}') as Partial<Record<AgentRole, unknown>>;
    const id = (pick: unknown) => (typeof pick === 'string' ? (pick as AgentId) : null);
    return { author: id(value.author), reviewer: id(value.reviewer) };
  } catch {
    return { author: null, reviewer: null };
  }
}

function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept across reloads; the choice still holds on this page.
  }
}

function readPanel() {
  try {
    return localStorage.getItem(PANEL_KEY) === 'true';
  } catch {
    return false;
  }
}

// The agent a role runs: the one picked if it can run here, else the first
// that can. A reviewer defaults to an agent other than the author's.
export function pickOf(agents: AgentInfo[] | null, picks: Picks, role: AgentRole): AgentInfo | null {
  const ready = agents?.filter((agent) => agent.available) ?? [];
  const picked = ready.find((agent) => agent.id === picks[role]);
  if (picked) return picked;
  if (role === 'reviewer') {
    const author = pickOf(agents, picks, 'author');
    return ready.find((agent) => agent.id !== author?.id) ?? ready.at(0) ?? null;
  }
  return ready.at(0) ?? null;
}

// The agents this Studio can run, the one picked per role (kept in this
// browser), whether the agent panel is open, and, in a change request
// (`inCr`), its runs as they stream in (server/agents/runs.ts).
export function useAgents(client: AgentsClient, inCr: boolean) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [picks, setPicks] = useState(readPicks);
  const [open, setOpen] = useState(readPanel);
  const [state, setState] = useState<RunsState>(EMPTY_RUNS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client.agents().then(
      (list) => { if (current) setAgents(list); },
      (reason: unknown) => { if (current) setError((reason as Error).message); },
    );
    return () => { current = false; };
  }, [client]);

  const reload = useCallback(async () => {
    if (!inCr) return;
    try {
      const runs = await client.runs();
      setState((current) => withList(current, runs));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, inCr]);

  useEffect(() => {
    if (!inCr) return undefined;
    return client.subscribe((event) => { setState((current) => withEvent(current, event)); }, () => { void reload(); });
  }, [client, inCr, reload]);

  const pick = useCallback((role: AgentRole, id: AgentId) => {
    setPicks((current) => {
      const next = { ...current, [role]: id };
      keep(PICKS_KEY, next);
      return next;
    });
  }, []);

  const setPanel = useCallback((next: boolean) => {
    setOpen(next);
    keep(PANEL_KEY, next);
  }, []);

  // A run that ended before this page streamed it: its events from the server.
  const load = useCallback(async (id: string) => {
    if (id in state.events) return;
    try {
      const run = await client.read(id);
      setState((current) => ({ runs: current.runs, events: { ...current.events, [id]: run.events } }));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, state.events]);

  return {
    agents,
    picks,
    pick,
    open,
    setPanel,
    runs: state.runs,
    events: state.events,
    error,
    clearError: () => { setError(null); },
    load,
    start: (role: AgentRole, prompt: string) => {
      const agent = pickOf(agents, picks, role);
      if (agent === null) return Promise.reject(new Error('No agent can run here: install one first.'));
      return client.start(agent.id, role, prompt);
    },
    cancel: (id: string) => client.cancel(id).catch((reason: unknown) => { setError((reason as Error).message); }),
    answer: (id: string, ask: string, optionId: string | null) => client.answer(id, ask, optionId).catch((reason: unknown) => { setError((reason as Error).message); }),
  };
}

export type Agents = ReturnType<typeof useAgents>;
