// Client for the agents API (server/agents/api.ts), in the worktree the page
// edits (src/api/workspace.ts). Types are server/agents/shared.ts.

import type { AgentId, AgentInfo, AgentRole, RunEvent, RunSummary, RunTotals, StreamEvent } from '../../server/agents/shared';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type { AgentId, AgentInfo, AgentRole, RunEvent, RunSummary, RunTotals, StreamEvent };
export type Run = { run: RunSummary; events: RunEvent[] };

// How long a refused event stream waits before it is opened again.
const REOPEN_MS = 5000;

const postJson = (path: string, body: unknown) =>
  studioFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorOf(response);
  return readJson<T>(response);
}

export function createAgentsClient(base = API_BASE) {
  return {
    async agents(): Promise<AgentInfo[]> {
      return (await answer<{ agents: AgentInfo[] }>(await studioFetch(`${base}/api/agents`))).agents;
    },
    // Runs and cost per change request, for their list (any workspace answers).
    async totals(): Promise<Record<string, RunTotals>> {
      return (await answer<{ totals: Record<string, RunTotals> }>(await studioFetch(`${base}/api/agents/totals`))).totals;
    },
    async runs(): Promise<RunSummary[]> {
      return (await answer<{ runs: RunSummary[] }>(await studioFetch(`${base}/api/agents/runs`))).runs;
    },
    async start(agent: AgentId, role: AgentRole, prompt: string): Promise<RunSummary> {
      return (await answer<{ run: RunSummary }>(await postJson(`${base}/api/agents/runs`, { agent, role, prompt }))).run;
    },
    async read(id: string): Promise<Run> {
      return answer<Run>(await studioFetch(`${base}/api/agents/runs/${id}`));
    },
    async cancel(id: string): Promise<void> {
      await answer(await postJson(`${base}/api/agents/runs/${id}/cancel`, {}));
    },
    // `optionId` null rejects.
    async answer(id: string, ask: string, optionId: string | null): Promise<void> {
      await answer(await postJson(`${base}/api/agents/runs/${id}/permissions/${ask}`, { optionId }));
    },
    // Every event of the change request's runs, from now on (and, on each
    // connect, the events so far of the runs going on). `onOpen` runs on
    // every connect, so the caller reads again what ended while it was down.
    // A stream the server refuses (signed out, 409) is opened again after a
    // pause; `onOpen` then goes through studioFetch, which tells the page
    // when nobody is signed in.
    subscribe(listener: (event: StreamEvent) => void, onOpen: () => void = () => undefined): () => void {
      let events: EventSource | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const open = () => {
        events = new EventSource(`${base}/api/agents/events`);
        events.onopen = onOpen;
        events.onmessage = (message: MessageEvent<string>) => { listener(JSON.parse(message.data) as StreamEvent); };
        events.onerror = () => {
          if (events?.readyState !== EventSource.CLOSED) return;
          onOpen();
          retry = setTimeout(open, REOPEN_MS);
        };
      };
      open();
      return () => {
        clearTimeout(retry);
        events?.close();
      };
    },
  };
}

export type AgentsClient = ReturnType<typeof createAgentsClient>;
