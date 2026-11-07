// What the server and the UI both say about proposals. No Node imports: the
// UI reads these types too.

// Who proposed: an agent run, or a person (a terminal agent of theirs).
export type ProposalAuthor =
  | { kind: 'run'; runId: string; agent: string; model: string | null }
  | { kind: 'person'; login: string | null };

// A hunk as stored: `removed` is what it replaces between its anchors when
// it was made (or last rebased), `added` what goes there (text/hunks.ts).
export type StoredHunk = {
  id: string;
  before: string | null;
  after: string | null;
  removed: string;
  added: string;
  count: number;
  index: number;
  decided: 'accepted' | 'rejected' | 'dropped' | null;
};

// A hunk as listed. `open`: it applies to the note now, at `from`..`to`;
// `stale`: the text between its anchors changed since, so it waits for a
// rebase or a drop.
export type HunkState = 'open' | 'stale' | 'accepted' | 'rejected' | 'dropped';
export type ProposalHunk = StoredHunk & { state: HunkState; from: number | null; to: number | null };

export type Proposal = {
  id: string;
  // Worktree path of the note, content/notes/….
  path: string;
  by: ProposalAuthor;
  // What the agent said the edit does, when it said.
  summary: string | null;
  createdMs: number;
  hunks: StoredHunk[];
};

// As listed, against the note on disk now (`mtimeMs`, null once it is gone).
export type ProposalView = Omit<Proposal, 'hunks'> & { hunks: ProposalHunk[]; mtimeMs: number | null; stale: boolean; done: boolean };

export type ProposalOp = 'accept' | 'reject' | 'rebase' | 'drop';
export const PROPOSAL_OPS: ProposalOp[] = ['accept', 'reject', 'rebase', 'drop'];

// A delete an agent proposed (propose_delete): the page (`x.mdx`) or folder
// (`x`) the tree deletes, relative to content/notes. `decided` is null
// until a person accepts (the delete ran) or rejects it.
export type DeleteProposal = {
  id: string;
  path: string;
  by: ProposalAuthor;
  summary: string | null;
  createdMs: number;
  decided: 'accepted' | 'rejected' | null;
};

// As listed: `gone` when it is still open but its page or folder is not there.
export type DeleteProposalView = DeleteProposal & { state: 'open' | 'accepted' | 'rejected' | 'gone' };
