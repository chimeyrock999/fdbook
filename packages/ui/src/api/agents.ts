// Client for the agents API (server/agents/api.ts), in the worktree the page
// edits (src/api/workspace.ts). Types are server/agents/shared.ts.

import type { AgentId, AgentInfo, AgentRole, Attachment, Conversation, ConversationEvent, ConversationRead, ConversationTotals, Mention, MentionKind, MessageContext, MessageSelection, StreamEvent, TurnChange } from '@fdbook/shared/agents.ts';
import { watchEvents } from './connection';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type { AgentId, AgentInfo, AgentRole, Attachment, Conversation, ConversationEvent, ConversationRead, ConversationTotals, Mention, MentionKind, MessageContext, MessageSelection, StreamEvent, TurnChange };

const postJson = (path: string, body: unknown) =>
  studioFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorOf(response);
  return readJson<T>(response);
}

export function createAgentsClient(base = API_BASE) {
  const one = (id: string) => `${base}/api/agents/conversations/${id}`;
  return {
    async agents(): Promise<AgentInfo[]> {
      return (await answer<{ agents: AgentInfo[] }>(await studioFetch(`${base}/api/agents`))).agents;
    },
    // Conversations and cost per change request, for their list (any workspace answers).
    async totals(): Promise<Record<string, ConversationTotals>> {
      return (await answer<{ totals: Record<string, ConversationTotals> }>(await studioFetch(`${base}/api/agents/totals`))).totals;
    },
    async conversations(): Promise<Conversation[]> {
      return (await answer<{ conversations: Conversation[] }>(await studioFetch(`${base}/api/agents/conversations`))).conversations;
    },
    // `context`: what goes with the message besides its text (#86).
    async start(agent: AgentId, role: AgentRole, prompt: string, context: MessageContext | null = null): Promise<Conversation> {
      return (await answer<{ conversation: Conversation }>(await postJson(`${base}/api/agents/conversations`, { agent, role, prompt, context }))).conversation;
    },
    async message(id: string, prompt: string, context: MessageContext | null = null): Promise<Conversation> {
      return (await answer<{ conversation: Conversation }>(await postJson(`${one(id)}/messages`, { prompt, context }))).conversation;
    },
    // Notes, assets and other files of the worktree to mention, best match first.
    async mentions(query: string): Promise<Mention[]> {
      return (await answer<{ mentions: Mention[] }>(await studioFetch(`${base}/api/agents/mentions?${new URLSearchParams({ q: query }).toString()}`))).mentions;
    },
    // A document for a message, kept with the change request's agents.
    async attach(file: File): Promise<Attachment> {
      const response = await studioFetch(`${base}/api/agents/attachments`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      return (await answer<{ attachment: Attachment }>(response)).attachment;
    },
    async read(id: string): Promise<ConversationRead> {
      return answer<ConversationRead>(await studioFetch(one(id)));
    },
    async remove(id: string): Promise<void> {
      await answer(await studioFetch(one(id), { method: 'DELETE' }));
    },
    async cancel(id: string): Promise<void> {
      await answer(await postJson(`${one(id)}/cancel`, {}));
    },
    // The files an ended turn changed, to keep or revert.
    async changes(id: string, turn: number): Promise<TurnChange[]> {
      return (await answer<{ changes: TurnChange[] }>(await studioFetch(`${one(id)}/turns/${String(turn)}/changes`))).changes;
    },
    async decide(id: string, turn: number, path: string, op: 'keep' | 'revert'): Promise<TurnChange> {
      return (await answer<{ change: TurnChange }>(await postJson(`${one(id)}/turns/${String(turn)}/changes`, { path, op }))).change;
    },
    // A file the turn changed: as it was before the turn, and as it is now
    // (null where it is missing).
    async compare(id: string, turn: number, path: string): Promise<{ before: string | null; after: string | null }> {
      const query = new URLSearchParams({ path }).toString();
      const { content: before } = await answer<{ content: string | null }>(await studioFetch(`${one(id)}/turns/${String(turn)}/changes/before?${query}`));
      const now = await studioFetch(`${base}/api/file?${query}`);
      const after = now.status === 404 ? null : (await answer<{ content: string }>(now)).content;
      return { before, after };
    },
    // `optionId` null rejects.
    async answer(id: string, ask: string, optionId: string | null): Promise<void> {
      await answer(await postJson(`${one(id)}/permissions/${ask}`, { optionId }));
    },
    // Every event of the change request's conversations, from now on (and,
    // on each connect, a snapshot of each one with a turn going on).
    // `onOpen` runs on every connect, so the caller reads again what
    // changed while it was down. The stream opens again after a drop,
    // under the page's connection watch (connection.ts).
    subscribe(listener: (event: StreamEvent) => void, onOpen: () => void = () => undefined): () => void {
      return watchEvents(`${base}/api/agents/events`, (events) => {
        events.onmessage = (message: MessageEvent<string>) => { listener(JSON.parse(message.data) as StreamEvent); };
      }, onOpen);
    },
  };
}

export type AgentsClient = ReturnType<typeof createAgentsClient>;
