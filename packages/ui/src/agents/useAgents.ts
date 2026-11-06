import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '#components/toasts.ts';
import { isConflict } from '#api/json.ts';
import { onMainInfo } from '@fdbook/shared/agents.ts';
import { OPENED_CHAT } from '#api/workspace.ts';
import type { AgentId, AgentInfo, AgentRole, AgentsClient, MessageContext } from '#api/agents.ts';
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

// Open when kept open, or when the page opens a chat (`?chat=`).
function readPanel() {
  if (OPENED_CHAT !== null) return true;
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
// browser), whether the agent panel is open, and, with change requests on
// (`enabled`: main and each change request), the conversations here as
// they stream in (server/agents/conversations.ts).
export function useAgents(client: AgentsClient, enabled: boolean, onMain = false) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [picks, setPicks] = useState(readPicks);
  const [open, setOpen] = useState(readPanel);
  const [state, setState] = useState<ConversationsState>(EMPTY_CONVERSATIONS);
  // Why the agents could not be listed (the picker says it).
  const [listError, setListError] = useState<string | null>(null);
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
      toast.error(reason);
    } finally {
      inFlight.current.delete(id);
    }
  }, [client]);

  useEffect(() => {
    let current = true;
    client.agents().then(
      (list) => { if (current) setAgents(onMain ? onMainInfo(list) : list); },
      (reason: unknown) => { if (current) setListError((reason as Error).message); },
    );
    return () => { current = false; };
  }, [client, onMain]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const listed = await client.conversations();
      setState((before) => withList(before, listed));
      // What the page holds may have gone on while the stream was down.
      for (const id of Object.keys(current.current.events)) if (listed.some((each) => each.id === id)) void read(id);
    } catch (reason) {
      toast.error(reason);
    }
  }, [client, enabled, read]);

  useEffect(() => {
    if (!enabled) return undefined;
    return client.subscribe((event) => {
      setState((before) => withEvent(before, event));
      // A turn of a conversation the page does not hold (another page sent it a message).
      if (unheld(current.current, event)) void read(event.conversationId);
    }, () => { void reload(); });
  }, [client, enabled, reload, read]);

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
    listError,
    load,
    start: (role: AgentRole, prompt: string, context: MessageContext | null = null) => {
      const agent = pickOf(agents, picks, role);
      if (agent === null) return Promise.reject(new Error('No agent can run here: install one first.'));
      return client.start(agent.id, role, prompt, context);
    },
    message: (id: string, prompt: string, context: MessageContext | null = null) => client.message(id, prompt, context),
    // Deletes each in turn, off the list at once (the stream tells other
    // pages); one that fails says why and the others go on.
    remove: async (ids: string[]) => {
      for (const id of ids) {
        try {
          await client.remove(id);
          setState((before) => withEvent(before, { type: 'deleted', at: Date.now(), conversationId: id }));
        } catch (reason) {
          toast.error(reason);
        }
      }
    },
    // A cancel or an answer the server says is done already (409: the turn
    // ended, another page answered) is no failure.
    cancel: (id: string) => client.cancel(id).catch((reason: unknown) => { if (!isConflict(reason)) throw reason; }),
    answer: (id: string, ask: string, optionId: string | null) => client.answer(id, ask, optionId).catch((reason: unknown) => { if (!isConflict(reason)) throw reason; }),
  };
}

export type Agents = ReturnType<typeof useAgents>;
