import type { Anchor, Thread, ThreadAuthor, ThreadSeverity, ThreadState } from '#api/proposals.ts';
import type { Placement } from './places';
import { agentName } from './authors';

// What the review threads' UI says and works with (#87).

export const STATE_LABELS: Record<ThreadState, string> = {
  open: 'Open',
  addressed: 'Addressed',
  rejected: 'Rejected',
  resolved: 'Resolved',
  'needs-decision': 'Needs a decision',
};

// What a person's button says for each move (shared.ts movesOf).
export const MOVE_LABELS: Record<ThreadState, string> = {
  open: 'Reopen',
  addressed: 'Mark addressed',
  rejected: 'Reject',
  resolved: 'Resolve',
  'needs-decision': 'Needs a decision',
};

// What a comment that moved the thread says it did.
export const MOVED: Record<ThreadState, string> = {
  open: 'reopened it',
  addressed: 'marked it addressed',
  rejected: 'rejected it',
  resolved: 'resolved it',
  'needs-decision': 'kept it: needs a decision',
};

export const SEVERITY_LABELS: Record<ThreadSeverity | 'comment', string> = { blocking: 'Blocking', nit: 'Nit', comment: 'Comment' };

export const nameOf = (by: ThreadAuthor) => (by.kind === 'run' ? agentName(by.agent) : (by.login ?? 'You'));

// The thread's first comment, which opened it.
export const openerOf = (thread: Thread) => thread.comments[0].by;

// What a thread can be asked to do from the page, as useProposals does it;
// each throws when the server refuses, for the button that sent it.
export type ThreadActions = {
  reply: (id: string, body: string) => Promise<void>;
  move: (id: string, state: ThreadState, body: string) => Promise<void>;
  // Shows the thread's suggestion among the note's (useNoteSuggestions).
  showSuggestion?: (proposalId: string) => void;
};

// A note's threads as the editor shows them (NoteEditor), and what opens one.
export type NoteThreadActions = ThreadActions & {
  open: (anchor: Anchor | null, body: string, severity: ThreadSeverity | null) => Promise<void>;
};

// A thread the Review panel asked to show; a new `seq` shows it again.
export type ThreadFocus = { id: string; seq: number };

// The threads on each block still there, by block, in note order: one mark per block.
export function threadGroups(placement: Placement) {
  const groups = new Map<number, Thread[]>();
  for (const { thread, block } of placement.threads) if (block !== null) groups.set(block, [...(groups.get(block) ?? []), thread]);
  return [...groups].sort(([a], [b]) => a - b);
}

// The marks the editor draws for threads (visual.ts `comments`): each
// block's, keyed by its first thread, and the comment box being written.
export function threadMarks(placement: Placement, draft: number | null) {
  const marks = threadGroups(placement).map(([block, threads]) => ({ key: threads[0].id, block }));
  return draft === null ? marks : [...marks, { key: 'draft', block: draft }];
}

// What the reviewer is asked by Review this CR: the diff against main and
// the style guide (#90) first, then one thread per finding.
export const REVIEW_PROMPT = [
  'Review this change request.',
  'Call cr_changes for what it changed against main, then read_note each changed note.',
  'Read the notes style guide first if the repository has one (see AGENTS.md); otherwise review against the lint issues cr_changes reports and the way the other notes are written.',
  'Call list_threads and do not repeat a thread that is still open.',
  'For each finding, open a thread with add_comment on the block it is about: severity blocking (it must change before it ships: a wrong fact, broken MDX or link, missing context) or nit (it would read better); the rule code when the guide has one; and a suggestion (edits) when you have the fix.',
  'End with one line: how many blocking and nit findings.',
].join(' ');

// The blocking threads that still wait: open, or kept by the reviewer for a person.
export const blockingCount = (threads: Thread[]) => threads.filter((thread) => thread.severity === 'blocking' && (thread.state === 'open' || thread.state === 'needs-decision')).length;

