// Client for the proposals and review threads APIs (server/proposals/api.ts,
// server/review/api.ts), in the worktree the page edits (src/api/workspace.ts).
// Types are server/proposals/shared.ts and server/review/shared.ts.

import type { DeleteProposalView, ProposalHunk, ProposalOp, ProposalView } from '@fdbook/shared/proposals.ts';
import type { Anchor } from '@fdbook/shared/anchors.ts';
import type { Thread, ThreadAuthor, ThreadSeverity, ThreadState } from '@fdbook/shared/review.ts';
import { watchEvents } from './connection';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type { Anchor, DeleteProposalView, ProposalHunk, ProposalOp, ProposalView, Thread, ThreadAuthor, ThreadSeverity, ThreadState };

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorOf(response);
  return readJson<T>(response);
}

const post = (url: string, body: unknown) => studioFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function createProposalsClient(base = API_BASE) {
  return {
    async list(): Promise<ProposalView[]> {
      return (await answer<{ proposals: ProposalView[] }>(await studioFetch(`${base}/api/proposals`))).proposals;
    },
    async threads(): Promise<Thread[]> {
      return (await answer<{ threads: Thread[] }>(await studioFetch(`${base}/api/threads`))).threads;
    },
    // A thread on the block `anchor` names (anchorAt), or on the whole note.
    async openThread(path: string, anchor: Anchor | null, body: string, severity: ThreadSeverity | null): Promise<Thread> {
      return (await answer<{ thread: Thread }>(await post(`${base}/api/threads`, { path, anchor, body, severity }))).thread;
    },
    async reply(id: string, body: string): Promise<Thread> {
      return (await answer<{ thread: Thread }>(await post(`${base}/api/threads/${id}/comments`, { body }))).thread;
    },
    async move(id: string, state: ThreadState, body: string): Promise<Thread> {
      return (await answer<{ thread: Thread }>(await post(`${base}/api/threads/${id}/state`, { state, body }))).thread;
    },
    // `hunks`: the ones to decide; all undecided ones without.
    async act(id: string, op: ProposalOp, hunks?: string[]): Promise<ProposalView> {
      const response = await studioFetch(`${base}/api/proposals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, hunks }) });
      return (await answer<{ proposal: ProposalView }>(response)).proposal;
    },
    async listDeletes(): Promise<DeleteProposalView[]> {
      return (await answer<{ proposals: DeleteProposalView[] }>(await studioFetch(`${base}/api/delete-proposals`))).proposals;
    },
    // Accept (the delete runs, with `base` from the dry run shown) or reject.
    async actOnDelete(id: string, op: 'accept' | 'reject', deleteBase?: string): Promise<DeleteProposalView> {
      const response = await studioFetch(`${base}/api/delete-proposals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, base: deleteBase }) });
      return (await answer<{ proposal: DeleteProposalView }>(response)).proposal;
    },
    // Each proposal as it is made or changes. `onOpen` runs on every
    // connect, so the caller reads again what changed while it was down.
    // Review threads come as `thread` events, delete proposals as
    // `delete-proposal` ones. The stream opens again after a drop, under
    // the page's connection watch (connection.ts).
    subscribe(listener: (proposal: ProposalView) => void, onOpen: () => void = () => undefined, onThread: (thread: Thread) => void = () => undefined, onDelete: (proposal: DeleteProposalView) => void = () => undefined): () => void {
      return watchEvents(`${base}/api/proposals/events`, (events) => {
        events.onmessage = (message: MessageEvent<string>) => { listener(JSON.parse(message.data) as ProposalView); };
        events.addEventListener('thread', (message: MessageEvent<string>) => { onThread(JSON.parse(message.data) as Thread); });
        events.addEventListener('delete-proposal', (message: MessageEvent<string>) => { onDelete(JSON.parse(message.data) as DeleteProposalView); });
      }, onOpen);
    },
  };
}

export type ProposalsClient = ReturnType<typeof createProposalsClient>;
