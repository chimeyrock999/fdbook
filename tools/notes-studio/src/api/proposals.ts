// Client for the proposals API (server/proposals/api.ts), in the worktree
// the page edits (src/api/workspace.ts). Types are server/proposals/shared.ts.

import type { NoteComment } from '../../server/proposals/comments';
import type { ProposalHunk, ProposalOp, ProposalView } from '../../server/proposals/shared';
import { watchEvents } from './connection';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type { NoteComment, ProposalHunk, ProposalOp, ProposalView };

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorOf(response);
  return readJson<T>(response);
}

export function createProposalsClient(base = API_BASE) {
  return {
    async list(): Promise<ProposalView[]> {
      return (await answer<{ proposals: ProposalView[] }>(await studioFetch(`${base}/api/proposals`))).proposals;
    },
    async comments(): Promise<NoteComment[]> {
      return (await answer<{ comments: NoteComment[] }>(await studioFetch(`${base}/api/comments`))).comments;
    },
    // `hunks`: the ones to decide; all undecided ones without.
    async act(id: string, op: ProposalOp, hunks?: string[]): Promise<ProposalView> {
      const response = await studioFetch(`${base}/api/proposals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, hunks }) });
      return (await answer<{ proposal: ProposalView }>(response)).proposal;
    },
    // Each proposal as it is made or changes. `onOpen` runs on every
    // connect, so the caller reads again what changed while it was down.
    // Comments come as `comment` events. The stream opens again after a
    // drop, under the page's connection watch (connection.ts).
    subscribe(listener: (proposal: ProposalView) => void, onOpen: () => void = () => undefined, onComment: (comment: NoteComment) => void = () => undefined): () => void {
      return watchEvents(`${base}/api/proposals/events`, (events) => {
        events.onmessage = (message: MessageEvent<string>) => { listener(JSON.parse(message.data) as ProposalView); };
        events.addEventListener('comment', (message: MessageEvent<string>) => { onComment(JSON.parse(message.data) as NoteComment); });
      }, onOpen);
    },
  };
}

export type ProposalsClient = ReturnType<typeof createProposalsClient>;
