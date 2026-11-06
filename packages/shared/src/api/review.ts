// What the server and the UI both say about review threads (#87). No Node
// imports: the UI reads these too.
import type { Anchor } from '#text/anchors.ts';

export type ThreadSeverity = 'blocking' | 'nit';
export const THREAD_SEVERITIES: ThreadSeverity[] = ['blocking', 'nit'];

export type ThreadState = 'open' | 'addressed' | 'rejected' | 'resolved' | 'needs-decision';
export const THREAD_STATES: ThreadState[] = ['open', 'addressed', 'rejected', 'resolved', 'needs-decision'];

// Who wrote: an agent run, with its model and role, or a person (a
// terminal agent of theirs too).
export type ThreadAuthor =
  | { kind: 'run'; runId: string; agent: string; model: string | null; role: 'author' | 'reviewer' }
  | { kind: 'person'; login: string | null };

// One message of a thread. `state` is the move it made, when it made one:
// the history of a thread is its comments.
export type ThreadComment = { id: string; body: string; by: ThreadAuthor; createdMs: number; state?: ThreadState };

// A thread on a note of the change request: on one block (`anchor`), or on
// the note as a whole (null). `orphaned` while that block is gone from the
// note; the anchor stays, so the thread finds the block again if it comes
// back. `rule` is the style guide's code for what it cites (#90);
// `suggestion` the proposal (#85) that answers it, the latest one.
export type Thread = {
  id: string;
  path: string;
  anchor: Anchor | null;
  orphaned: boolean;
  severity: ThreadSeverity | null;
  rule: string | null;
  state: ThreadState;
  suggestion: string | null;
  comments: ThreadComment[];
  createdMs: number;
  updatedMs: number;
};

// Who moves a thread: the author agent answers it, the reviewer agent
// judges the answer, a person may do either and has the last word.
export type Mover = 'person' | 'author' | 'reviewer';
export const moverOf = (by: ThreadAuthor): Mover => (by.kind === 'person' ? 'person' : by.role);

const MOVES: Record<ThreadState, Partial<Record<ThreadState, Mover[]>>> = {
  open: { addressed: ['author', 'person'], rejected: ['author', 'person'], resolved: ['reviewer', 'person'] },
  addressed: { open: ['reviewer', 'person'], resolved: ['reviewer', 'person'] },
  rejected: { resolved: ['reviewer', 'person'], 'needs-decision': ['reviewer', 'person'], open: ['person'] },
  'needs-decision': { open: ['person'], resolved: ['person'] },
  resolved: { open: ['person'] },
};

// The states `mover` may take `thread` to. The reviewer withdraws its own
// open findings (or another agent's); a person's waits for the author's
// answer or a person.
export const movesOf = (thread: Pick<Thread, 'state' | 'comments'>, mover: Mover) =>
  THREAD_STATES.filter((to) => MOVES[thread.state][to]?.includes(mover) === true && !(mover === 'reviewer' && thread.state === 'open' && to === 'resolved' && thread.comments[0]?.by.kind === 'person'));

// A rejection says why.
export const needsReason = (to: ThreadState) => to === 'rejected';

// Whether a thread still waits on someone: anything not resolved.
export const isOpen = (thread: Pick<Thread, 'state'>) => thread.state !== 'resolved';
