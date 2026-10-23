import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId, AgentInfo, AgentRole, AgentsClient } from '../api/agents';
import { EMPTY_CONVERSATIONS, reading, unheld, unread, withEvent, withList, withRead, type ConversationsState } from './transcript';

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
// (`inCr`), its conversations as they stream in (server/agents/conversations.ts).
export function useAgents(client: AgentsClient, inCr: boolean) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [picks, setPicks] = useState(readPicks);
  const [open, setOpen] = useState(readPanel);
  const [state, setState] = useState<ConversationsState>(EMPTY_CONVERSATIONS);
  const [error, setError] = useState<string | null>(null);
  // The state as last rendered, and the reads in flight, for the stream's listener.
  const current = useRef(state);
  useEffect(() => { current.current = state; });
  const inFlight = useRef(new Set<string>());

  // Reads a conversation whole; the stream's events for it wait meanwhile.
  const read = useCallback(async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setState((before) => reading(before, id));
    try {
      const whole = await client.read(id);
      setState((before) => withRead(before, id, whole));
    } catch (reason) {
      setState((before) => unread(before, id));
      setError((reason as Error).message);
    } finally {
      inFlight.current.delete(id);
    }
  }, [client]);

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
      const listed = await client.conversations();
      setState((before) => withList(before, listed));
      // What the page holds may have gone on while the stream was down.
      for (const id of Object.keys(current.current.events)) if (listed.some((each) => each.id === id)) void read(id);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, inCr, read]);

  useEffect(() => {
    if (!inCr) return undefined;
    return client.subscribe((event) => {
      setState((before) => withEvent(before, event));
      // A turn of a conversation the page does not hold (another page sent it a message).
      if (unheld(current.current, event)) void read(event.conversationId);
    }, () => { void reload(); });
  }, [client, inCr, reload, read]);

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

  // A conversation this page did not follow from its start: its events from the server.
  const load = useCallback(async (id: string) => {
    if (id in current.current.events) return;
    await read(id);
  }, [read]);

  const failed = (reason: unknown) => { setError((reason as Error).message); };

  return {
    client,
    agents,
    picks,
    pick,
    open,
    setPanel,
    conversations: state.conversations,
    events: state.events,
    decisions: state.decisions,
    error,
    clearError: () => { setError(null); },
    load,
    start: (role: AgentRole, prompt: string) => {
      const agent = pickOf(agents, picks, role);
      if (agent === null) return Promise.reject(new Error('No agent can run here: install one first.'));
      return client.start(agent.id, role, prompt);
    },
    message: (id: string, prompt: string) => client.message(id, prompt),
    // Deletes each in turn, off the list at once (the stream tells other pages).
    remove: async (ids: string[]) => {
      for (const id of ids) {
        try {
          await client.remove(id);
          setState((before) => withEvent(before, { type: 'deleted', at: Date.now(), conversationId: id }));
        } catch (reason) {
          failed(reason);
        }
      }
    },
    cancel: (id: string) => client.cancel(id).catch(failed),
    answer: (id: string, ask: string, optionId: string | null) => client.answer(id, ask, optionId).catch(failed),
  };
}

export type Agents = ReturnType<typeof useAgents>;
