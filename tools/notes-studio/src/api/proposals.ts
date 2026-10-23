// Client for the proposals API (server/proposals/api.ts), in the worktree
// the page edits (src/api/workspace.ts). Types are server/proposals/shared.ts.

import type { NoteComment } from '../../server/proposals/comments';
import type { ProposalHunk, ProposalOp, ProposalView } from '../../server/proposals/shared';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type { NoteComment, ProposalHunk, ProposalOp, ProposalView };

// How long a refused event stream waits before it is opened again.
const REOPEN_MS = 5000;

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
    // Comments come as `comment` events.
    subscribe(listener: (proposal: ProposalView) => void, onOpen: () => void = () => undefined, onComment: (comment: NoteComment) => void = () => undefined): () => void {
      let events: EventSource | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const open = () => {
        events = new EventSource(`${base}/api/proposals/events`);
        events.onopen = onOpen;
        events.onmessage = (message: MessageEvent<string>) => { listener(JSON.parse(message.data) as ProposalView); };
        events.addEventListener('comment', (message: MessageEvent<string>) => { onComment(JSON.parse(message.data) as NoteComment); });
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

export type ProposalsClient = ReturnType<typeof createProposalsClient>;
