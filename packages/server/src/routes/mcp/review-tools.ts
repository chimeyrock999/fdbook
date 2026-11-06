import { z } from 'zod';
import { atLeast } from '@fdbook/shared/auth.ts';
import { changedSinceBase, loadDiff } from '#services/git/diff.ts';
import { HttpError } from '#infra/http.ts';
import { loadLintContexts } from '#services/lint/context.ts';
import { lintNote } from '#services/lint/lint.ts';
import { hunksOf } from '@fdbook/shared/hunks.ts';
import type { ProposalAuthor } from '@fdbook/shared/proposals.ts';
import type { Proposals } from '#services/proposals/store.ts';
import type { Thread, ThreadAuthor } from '@fdbook/shared/review.ts';
import { anchorFor, type Threads } from '#services/review/threads.ts';
import { classifyPath, NOTES_DIR } from '#infra/security/paths.ts';
import { json, notePath } from './note-tools.ts';
import type { StudioTool, StudioToolContext } from './tool.ts';

// What the review tools need of a change request besides its worktree.
export type ReviewToolDeps = {
  // Both refuse main, which has none.
  threadsOf: (slug: string) => Promise<Threads>;
  proposalsOf: (slug: string) => Promise<Proposals | null>;
  // The model a run says it runs, when it said.
  modelOf: (slug: string, runId: string) => string | null;
};

// cr_changes answers at most this much hunk text; read_note has the rest.
const MAX_CHANGES_TEXT = 200_000;

const path = z.string().min(1).describe(`The note: ${NOTES_DIR}/<path>.mdx, or <path>.mdx relative to ${NOTES_DIR}`);
const thread = z.string().min(1).max(64).describe('The thread id, as add_comment or list_threads gave it');
const body = z.string().min(1).max(10_000);
const edits = z.array(z.object({ find: z.string().min(1), replace: z.string() })).max(100);

const addInput = z.object({
  path,
  block: z.number().int().min(0).optional(),
  body,
  severity: z.enum(['blocking', 'nit']).optional(),
  rule: z.string().max(64).optional().describe('The style guide checklist code the finding cites, e.g. voice.direct'),
  suggestion: z.object({ content: z.string().optional(), edits: edits.optional(), summary: z.string().max(2000).optional() }).optional(),
});
const replyInput = z.object({ thread, body });
const stateInput = z.object({
  thread,
  state: z.enum(['open', 'addressed', 'rejected', 'resolved', 'needs-decision']),
  body: z.string().max(10_000).optional(),
  suggestion: z.string().max(64).optional().describe('The id of the proposal (propose_edit) that fixes it'),
});
const listInput = z.object({
  path: path.optional(),
  state: z.enum(['open', 'addressed', 'rejected', 'resolved', 'needs-decision', 'all']).optional(),
  severity: z.enum(['blocking', 'nit']).optional(),
});
const changesInput = z.object({});

// The review threads (#87), for agents and a person's terminal agent. Every
// tool here is open to a reviewer run: a thread is not an edit, and a
// suggestion is a proposal a person still accepts. A person needs write
// access to change threads, as for any other write of the Studio.
export function createReviewTools(deps: ReviewToolDeps): StudioTool[] {
  const authorOf = (ctx: StudioToolContext): ThreadAuthor =>
    ctx.caller.kind === 'run'
      ? { kind: 'run', runId: ctx.caller.runId, agent: ctx.caller.agent, model: deps.modelOf(ctx.slug, ctx.caller.runId), role: ctx.caller.role }
      : { kind: 'person', login: ctx.caller.login };
  const mayWrite = (ctx: StudioToolContext, tool: string) => {
    if (ctx.caller.kind === 'person' && !atLeast(ctx.caller.role, 'writer')) throw new HttpError(403, `${tool} needs write access`);
  };
  const readNote = async (ctx: StudioToolContext, at: string) => {
    const note = await ctx.files.read(at);
    if (note === null) throw new HttpError(404, `no such note: ${at}`);
    return note;
  };
  // A suggestion made with a comment: a proposal on the note, as
  // propose_edit makes one.
  const suggest = async (ctx: StudioToolContext, at: string, given: { content?: string; edits?: { find: string; replace: string }[]; summary?: string }) => {
    if ((given.content === undefined) === (given.edits === undefined)) throw new HttpError(400, 'a suggestion takes either content or edits');
    const proposals = await deps.proposalsOf(ctx.slug);
    if (proposals === null) throw new HttpError(409, 'main is read only: suggest in a change request');
    const by = authorOf(ctx);
    const proposer: ProposalAuthor = by.kind === 'run' ? { kind: 'run', runId: by.runId, agent: by.agent, model: by.model } : by;
    const proposal = await proposals.propose({ path: at, content: given.content, edits: given.edits, by: proposer, summary: given.summary ?? null });
    return { id: proposal.id, hunks: proposal.hunks.length };
  };
  const summaryOf = (each: Thread) => ({
    id: each.id,
    path: each.path,
    block: each.anchor === null || each.orphaned ? null : each.anchor.index,
    orphaned: each.orphaned,
    quote: each.anchor?.text.split('\n')[0]?.slice(0, 120) ?? null,
    severity: each.severity,
    rule: each.rule,
    state: each.state,
    suggestion: each.suggestion,
    comments: each.comments.map((comment) => ({
      by: comment.by.kind === 'run' ? `${comment.by.agent} (${comment.by.role})` : (comment.by.login ?? 'person'),
      body: comment.body,
      ...(comment.state === undefined ? {} : { state: comment.state }),
    })),
  });

  const addComment = {
    name: 'add_comment',
    description: 'Opens a review thread on a note: on one of its blocks (the index read_note gives) or on the note as a whole. A reviewer comments here instead of editing: give each finding a severity, blocking (must change before it ships) or nit (would be better), and the rule it breaks when the style guide has one. A suggestion (content or find/replace edits, as propose_edit takes) goes with the comment as a proposal the person accepts or rejects. Answers the thread id.',
    input: addInput,
    access: 'read',
    async run({ path: given, block, body: text, severity, rule, suggestion }, ctx) {
      mayWrite(ctx, 'add_comment');
      const at = notePath(given);
      const note = await readNote(ctx, at);
      const threads = await deps.threadsOf(ctx.slug);
      // Refused before the suggestion is made, so a refused comment leaves no proposal behind.
      const anchor = anchorFor(at, note.content, block ?? null, rule ?? null);
      if (text.trim() === '') throw new HttpError(400, 'a comment needs some text');
      const proposal = suggestion === undefined ? null : await suggest(ctx, at, suggestion);
      const opened = await threads.open({ path: at, anchor, body: text, by: authorOf(ctx), severity: severity ?? null, rule: rule ?? null, suggestion: proposal?.id ?? null });
      return json({ id: opened.id, path: at, block: opened.anchor?.index ?? null, state: opened.state, suggestion: proposal });
    },
  } satisfies StudioTool<typeof addInput>;

  const replyTool = {
    name: 'reply_to_thread',
    description: 'Replies to a review thread without changing its state.',
    input: replyInput,
    access: 'read',
    async run({ thread: id, body: text }, ctx) {
      mayWrite(ctx, 'reply_to_thread');
      return json(summaryOf(await (await deps.threadsOf(ctx.slug)).reply(id, { body: text, by: authorOf(ctx) })));
    },
  } satisfies StudioTool<typeof replyInput>;

  const setState = {
    name: 'set_thread_state',
    description: 'Moves a review thread, with a comment on why. An author answers an open thread: addressed (fixed: propose the fix with propose_edit first and pass its id as suggestion) or rejected (body says why). A reviewer judges the answer: resolved, open again when the fix falls short, or needs-decision when it keeps a finding the author rejected; a person then decides. A reviewer may also resolve an open thread an agent opened (withdrawing its finding), not one a person opened. A person may make any move.',
    input: stateInput,
    access: 'read',
    async run({ thread: id, state, body: text, suggestion }, ctx) {
      mayWrite(ctx, 'set_thread_state');
      const threads = await deps.threadsOf(ctx.slug);
      if (suggestion !== undefined) {
        const proposal = await (await deps.proposalsOf(ctx.slug))?.read(suggestion).catch(() => null);
        if (proposal?.path !== (await threads.read(id)).path) throw new HttpError(400, `no proposal ${suggestion} on this thread's note`);
      }
      return json(summaryOf(await threads.move(id, { state, body: text, by: authorOf(ctx), suggestion })));
    },
  } satisfies StudioTool<typeof stateInput>;

  const listThreads = {
    name: 'list_threads',
    description: 'Lists the review threads of the change request, oldest first: where each is (block index, null when on the whole note or its block is gone: orphaned), its severity, state, suggestion and every comment. Without state, the ones not resolved.',
    input: listInput,
    access: 'read',
    async run({ path: given, state, severity }, ctx) {
      const threads = await (await deps.threadsOf(ctx.slug)).list(given === undefined ? undefined : notePath(given));
      const shown = threads.filter((each) => (state === 'all' || (state === undefined ? each.state !== 'resolved' : each.state === state)) && (severity === undefined || each.severity === severity));
      return json({ threads: shown.map(summaryOf) });
    },
  } satisfies StudioTool<typeof listInput>;

  const crChanges = {
    name: 'cr_changes',
    description: 'What the change request changed against main: every changed file (M modified, A added, D deleted, R renamed), and for each note the changed blocks (removed and added text, each after the block they follow) and the lint issues of the note now. Start a review here, then read_note the notes for their whole text.',
    input: changesInput,
    access: 'read',
    async run(_args, ctx) {
      let budget = MAX_CHANGES_TEXT;
      const files = [];
      const contextOf = await loadLintContexts(ctx.root);
      for (const file of await changedSinceBase(ctx.root)) {
        if (classifyPath(file.path) !== 'note') {
          files.push(file);
          continue;
        }
        const diff = await loadDiff(ctx.root, file.path, file.from);
        const before = diff.before?.kind === 'text' ? diff.before.text : '';
        const after = diff.after?.kind === 'text' ? diff.after.text : '';
        let hunks: { after: string | null; removed: string; added: string }[] | null = null;
        try {
          hunks = hunksOf(before, after).map((hunk) => ({ after: hunk.before, removed: hunk.removed, added: hunk.added }));
        } catch {
          // A side that does not parse: read_note shows the note whole.
        }
        const size = (hunks ?? []).reduce((total, hunk) => total + hunk.removed.length + hunk.added.length, 0);
        const shown = hunks !== null && size <= budget;
        if (shown) budget -= size;
        const lint = diff.after === null ? [] : lintNote(after, contextOf(file.path.slice(NOTES_DIR.length + 1)));
        files.push({
          ...file,
          ...(shown ? { hunks } : { hunks: null, note: hunks === null ? 'does not parse: read_note it' : 'too long to show here: read_note it' }),
          lint: lint.map((issue) => ({ rule: issue.rule, severity: issue.severity, message: issue.message, line: issue.start.line })),
        });
      }
      return json({ files });
    },
  } satisfies StudioTool<typeof changesInput>;

  return [addComment, replyTool, setState, listThreads, crChanges] as StudioTool[];
}
