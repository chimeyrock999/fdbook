import { visit } from 'unist-util-visit';
import { z } from 'zod';
import { listAssets } from '../assets/ops.ts';
import { HttpError } from '../http.ts';
import { loadLintContext } from '../lint/context.ts';
import { lintNote, parseNote } from '../lint/lint.ts';
import { pageUrl, resolveHref } from '../lint/rules/links.ts';
import type { DeleteProposals } from '../proposals/deletes.ts';
import { blocksOf, lineAt } from '../proposals/hunks.ts';
import type { ProposalAuthor } from '../proposals/shared.ts';
import { applyEdits, type Proposals } from '../proposals/store.ts';
import { classifyPath, NOTES_DIR } from '../security/paths.ts';
import { readNotesContent } from '../tree/build.ts';
import type { StudioTool, StudioToolContext, ToolResult } from './tool.ts';

// What the note tools need of a change request besides its worktree.
export type NoteToolDeps = {
  // Null on main, which has none.
  proposalsOf: (slug: string) => Promise<Proposals | null>;
  // Null on main too.
  deletesOf: (slug: string) => Promise<DeleteProposals | null>;
  // The model a run says it runs, when it said.
  modelOf: (slug: string, runId: string) => string | null;
  // Whether a run going on created the note itself (agents/watch.ts).
  createdBy: (slug: string, runId: string, path: string) => Promise<boolean>;
  // The note, lines and their MDX a person selected for the run's turn going on, if any (agents/context.ts).
  selectionOf?: (slug: string, runId: string) => { path: string; lines: [number, number]; source: string } | null;
};

// The selected lines as the note on disk has them: the editor's text may
// hold edits not saved yet, so they are found by their MDX, nearest the
// lines the editor named. Null when they are not on disk as selected (or
// were too long to send), so nothing can be said of them.
export function linesOnDisk(text: string, { lines, source }: { lines: [number, number]; source: string }): [number, number] | null {
  if (source === '') return null;
  let best: number | null = null;
  for (let at = text.indexOf(source); at !== -1; at = text.indexOf(source, at + 1)) {
    if (best === null || Math.abs(lineAt(text, at) - lines[0]) < Math.abs(lineAt(text, best) - lines[0])) best = at;
  }
  if (best === null) return null;
  const first = lineAt(text, best);
  return [first, first + lines[1] - lines[0]];
}

// The hunks of a proposal on `text` that touch none of `lines`, give or take
// the blank line around them (a hunk holds the blank lines about its blocks).
export function hunksOutside(text: string, hunks: { id: string; from: number | null; to: number | null }[], [first, last]: [number, number]) {
  return hunks.filter((hunk) => {
    if (hunk.from === null || hunk.to === null) return false;
    const start = lineAt(text, hunk.from);
    const end = hunk.to > hunk.from ? lineAt(text, hunk.to - 1) : start;
    return end < first - 1 || start > last + 1;
  }).map((hunk) => hunk.id);
}

export const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structured: value as Record<string, unknown> });

// A note's worktree path from what an agent passes: `content/notes/x.mdx`,
// or `x.mdx` relative to content/notes.
export function notePath(path: string) {
  const trimmed = path.trim().replace(/^\/+/, '');
  return trimmed.startsWith(`${NOTES_DIR}/`) ? trimmed : `${NOTES_DIR}/${trimmed}`;
}

// A page or folder as the tree deletes it, relative to content/notes, from
// what an agent passes: `content/notes/x.mdx`, `x.mdx`, `x` or `x/`.
export function treePath(path: string) {
  const trimmed = path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed.startsWith(`${NOTES_DIR}/`) ? trimmed.slice(NOTES_DIR.length + 1) : trimmed;
}

export const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
export const text = (value: unknown) => (typeof value === 'string' ? value : null);

// Each note's frontmatter, by path relative to content/notes.
export async function notesOf(root: string) {
  const { pages, mtimes } = await readNotesContent(root);
  return [...pages].map(([path, data]) => ({ path, data, mtimeMs: mtimes?.get(path) ?? null })).sort((a, b) => a.path.localeCompare(b.path));
}

async function readNote(ctx: StudioToolContext, path: string) {
  const note = await ctx.files.read(path);
  if (note === null) throw new HttpError(404, `no such note: ${path}`);
  return note;
}

// The note (relative to content/notes) that `href` from the note at `from`
// reaches, as the lint resolves it (lint/rules/links.ts), or null.
export function linkTarget(href: string, from: string, pages: ReadonlySet<string>, byUrl: ReadonlyMap<string, string>) {
  let resolved;
  try {
    resolved = resolveHref(href, from, pages);
  } catch {
    return null;
  }
  if (resolved === null || 'missing' in resolved) return null;
  return 'page' in resolved ? resolved.page : (byUrl.get(resolved.url) ?? null);
}

// Every note a note's links reach, by path relative to content/notes.
export function linksOf(source: string, from: string, pages: ReadonlySet<string>, byUrl: ReadonlyMap<string, string>) {
  const found = new Set<string>();
  try {
    visit(parseNote(source), (node) => {
      if (node.type !== 'link' && node.type !== 'definition') return;
      const target = linkTarget(node.url, from, pages, byUrl);
      if (target !== null && target !== from) found.add(target);
    });
  } catch {
    // A note that does not parse links nowhere.
  }
  return [...found].sort();
}

// A graph's keywords (frontmatter `graph.keywords`, a section's `keywords`).
const keywordEntriesOf = (value: unknown) => (Array.isArray(value)
  ? value.flatMap((item: unknown) => {
    const { id, displayName } = (typeof item === 'object' && item !== null ? item : {}) as { id?: unknown; displayName?: unknown };
    return typeof id === 'string' ? [{ id, displayName: typeof displayName === 'string' ? displayName : id }] : [];
  })
  : []);

// Every graph keyword of a note's frontmatter, its sections' too.
export function graphKeywordEntriesOf(data: Record<string, unknown>) {
  const graph = (data.graph ?? {}) as { keywords?: unknown; sections?: unknown };
  const sections = Array.isArray(graph.sections) ? graph.sections : [];
  return [...keywordEntriesOf(graph.keywords), ...sections.flatMap((section: unknown) => keywordEntriesOf((section as { keywords?: unknown }).keywords))];
}

export const graphKeywordsOf = (data: Record<string, unknown>) => graphKeywordEntriesOf(data).map((keyword) => keyword.id);

const authorOf = (ctx: StudioToolContext, deps: NoteToolDeps): ProposalAuthor =>
  ctx.caller.kind === 'run'
    ? { kind: 'run', runId: ctx.caller.runId, agent: ctx.caller.agent, model: deps.modelOf(ctx.slug, ctx.caller.runId) }
    : { kind: 'person', login: ctx.caller.login };

const path = z.string().min(1).describe('The note: content/notes/<path>.mdx, or <path>.mdx relative to content/notes');

export function createNoteTools(deps: NoteToolDeps): StudioTool[] {
  const listNotes: StudioTool<z.ZodObject<Record<string, never>>> = {
    name: 'list_notes',
    description: 'Lists every note of the change request: its path, title, description, tags and keywords.',
    input: z.object({}),
    access: 'read',
    async run(_args, ctx) {
      const notes = await notesOf(ctx.root);
      return json({
        notes: notes.map(({ path: page, data, mtimeMs }) => ({
          path: `${NOTES_DIR}/${page}`,
          title: text(data.title),
          description: text(data.description),
          tags: strings(data.tags),
          keywords: strings(data.keywords),
          mtimeMs,
        })),
      });
    },
  };

  const readNoteTool = {
    name: 'read_note',
    description: 'Reads a note: its whole MDX text, its top-level blocks (index, first line), and the proposals waiting on it. Block indexes are what add_comment (review-tools.ts) takes.',
    input: z.object({ path }),
    access: 'read',
    async run({ path: given }, ctx) {
      const at = notePath(given);
      const note = await readNote(ctx, at);
      let blocks: { index: number; line: number; preview: string }[] = [];
      try {
        blocks = blocksOf(note.content).map((block, index) => ({
          index,
          line: note.content.slice(0, block.start).split('\n').length,
          preview: block.text.split('\n')[0]?.slice(0, 80) ?? '',
        }));
      } catch {
        // A note that does not parse is shown whole.
      }
      const waiting = ((await (await deps.proposalsOf(ctx.slug))?.list(at)) ?? []).filter((proposal) => !proposal.done);
      return json({
        path: at,
        mtimeMs: note.mtimeMs,
        content: note.content,
        blocks,
        proposals: waiting.map((proposal) => ({ id: proposal.id, by: proposal.by, summary: proposal.summary, stale: proposal.stale, hunks: proposal.hunks.filter((hunk) => hunk.decided === null).length })),
      });
    },
  } satisfies StudioTool<z.ZodObject<{ path: typeof path }>>;

  const searchNotes = {
    name: 'search_notes',
    description: 'Finds notes whose title, description, tags or text contain every word of the query (case does not matter). Answers each note with up to three matching lines.',
    input: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).optional() }),
    access: 'read',
    async run({ query, limit = 20 }, ctx) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const results = [];
      const notes = await notesOf(ctx.root);
      const texts = await Promise.all(notes.map(({ path: page }) => ctx.files.read(`${NOTES_DIR}/${page}`)));
      for (const [index, { path: page, data }] of notes.entries()) {
        const at = `${NOTES_DIR}/${page}`;
        const note = texts[index];
        if (note === null) continue;
        const haystack = [text(data.title) ?? '', text(data.description) ?? '', ...strings(data.tags), note.content].join('\n').toLowerCase();
        if (!words.every((word) => haystack.includes(word))) continue;
        const lines = note.content.split('\n').flatMap((line, index) => (words.some((word) => line.toLowerCase().includes(word)) ? [{ line: index + 1, text: line.trim().slice(0, 200) }] : []));
        results.push({ path: at, title: text(data.title), matches: lines.slice(0, 3) });
        if (results.length >= limit) break;
      }
      return json({ results });
    },
  } satisfies StudioTool<z.ZodObject<{ query: z.ZodString; limit: z.ZodOptional<z.ZodNumber> }>>;

  const noteGraph = {
    name: 'note_graph',
    description: 'A note in the notes graph: the notes it links to, the notes that link to it, its tags and keywords (frontmatter and graph keywords), and the notes that share a tag.',
    input: z.object({ path }),
    access: 'read',
    async run({ path: given }, ctx) {
      const at = notePath(given);
      const page = at.slice(NOTES_DIR.length + 1);
      const notes = await notesOf(ctx.root);
      const self = notes.find((note) => note.path === page);
      if (self === undefined) throw new HttpError(404, `no such note: ${at}`);
      const pages = new Set(notes.map((note) => note.path));
      const byUrl = new Map(notes.map((note) => [pageUrl(note.path), note.path]));
      const texts = await Promise.all(notes.map((note) => ctx.files.read(`${NOTES_DIR}/${note.path}`)));
      const links = new Map(notes.map((note, index) => [note.path, linksOf(texts[index]?.content ?? '', note.path, pages, byUrl)]));
      const tags = strings(self.data.tags);
      const full = (each: string) => `${NOTES_DIR}/${each}`;
      return json({
        path: at,
        title: text(self.data.title),
        linksTo: (links.get(page) ?? []).map(full),
        linkedFrom: notes.filter((note) => note.path !== page && (links.get(note.path) ?? []).includes(page)).map((note) => full(note.path)),
        tags,
        keywords: strings(self.data.keywords),
        graphKeywords: graphKeywordsOf(self.data),
        sharesTags: notes.filter((note) => note.path !== page && strings(note.data.tags).some((tag) => tags.includes(tag))).map((note) => full(note.path)),
      });
    },
  } satisfies StudioTool<z.ZodObject<{ path: typeof path }>>;

  const proposeEdit = {
    name: 'propose_edit',
    description: 'Proposes an edit to a note. A note that does not exist yet is created with content (list it in its folder\'s meta.yaml); later edits by the same run to a note it created are written too (answer: written), until someone else changes that note. An edit to any other note is not written: a person sees it in the editor as suggestions, block by block, and accepts or rejects each one. Give either the whole new text (content) or exact find/replace edits on the note as it is now (each find must occur once). Answers the proposal, its hunks, lint issues of the result to fix in a new proposal, and, when the person selected lines for the message, the hunks that change other lines (outsideSelection).',
    input: z.object({
      path,
      content: z.string().optional().describe('The whole note as it should be, frontmatter included'),
      edits: z.array(z.object({ find: z.string().min(1), replace: z.string() })).max(100).optional().describe('Exact text to find (once) and what replaces it'),
      summary: z.string().max(2000).optional().describe('One line on what the edit does, shown to the person'),
    }),
    access: 'write',
    async run({ path: given, content, edits, summary }, ctx) {
      const at = notePath(given);
      // A new note has nothing to suggest against: it is written (and, for
      // a run, goes on its Keep/Revert list). It must parse like any note.
      if (content !== undefined && classifyPath(at) === 'note' && (await ctx.files.read(at)) === null) {
        try {
          blocksOf(content);
        } catch (error) {
          throw new HttpError(422, `the new note does not parse: ${(error as Error).message}`);
        }
        await ctx.files.write(at, content, { baseMtime: null });
        const issues = lintNote(content, await loadLintContext(ctx.root, at.slice(NOTES_DIR.length + 1)));
        return json({ created: true, path: at, lint: issues.map((issue) => ({ rule: issue.rule, severity: issue.severity, message: issue.message, line: issue.start.line })) });
      }
      // A note this run created is its own draft, not yet a person's: a fix
      // to it is written too, and stays on the run's Keep/Revert list.
      if (ctx.caller.kind === 'run' && (await deps.createdBy(ctx.slug, ctx.caller.runId, at))) {
        if ((content === undefined) === (edits === undefined)) throw new HttpError(400, 'give either content or edits');
        const current = await readNote(ctx, at);
        const next = content ?? applyEdits(current.content, edits ?? []);
        try {
          blocksOf(next);
        } catch (error) {
          throw new HttpError(422, `the note does not parse: ${(error as Error).message}`);
        }
        await ctx.files.write(at, next, { baseMtime: current.mtimeMs });
        const issues = lintNote(next, await loadLintContext(ctx.root, at.slice(NOTES_DIR.length + 1)));
        return json({ written: true, path: at, lint: issues.map((issue) => ({ rule: issue.rule, severity: issue.severity, message: issue.message, line: issue.start.line })) });
      }
      const proposals = await deps.proposalsOf(ctx.slug);
      if (proposals === null) throw new Error('main is read only: edit in a change request');
      const selection = ctx.caller.kind === 'run' ? (deps.selectionOf?.(ctx.slug, ctx.caller.runId) ?? null) : null;
      const before = selection?.path === at ? await ctx.files.read(at) : null;
      const proposal = await proposals.propose({ path: at, content, edits, by: authorOf(ctx, deps), summary: summary ?? null });
      const issues = lintNote(proposal.text, await loadLintContext(ctx.root, at.slice(NOTES_DIR.length + 1)));
      const onDisk = selection === null || before === null ? null : linesOnDisk(before.content, selection);
      const outside = onDisk === null || before === null ? [] : hunksOutside(before.content, proposal.hunks, onDisk);
      return json({
        id: proposal.id,
        path: at,
        hunks: proposal.hunks.map((hunk) => ({ id: hunk.id, state: hunk.state, removed: hunk.removed, added: hunk.added })),
        lint: issues.map((issue) => ({ rule: issue.rule, severity: issue.severity, message: issue.message, line: issue.start.line })),
        // The person selected lines for this message: say which hunks went elsewhere.
        ...(outside.length > 0 && onDisk !== null
          ? { outsideSelection: { lines: onDisk, hunks: outside, message: `hunks ${outside.join(', ')} change lines outside the selection (${String(onDisk[0])}-${String(onDisk[1])}); drop them with a new proposal unless the message asked for that` } }
          : {}),
      });
    },
  } satisfies StudioTool<z.ZodObject<{ path: typeof path; content: z.ZodOptional<z.ZodString>; edits: z.ZodOptional<z.ZodArray<z.ZodObject<{ find: z.ZodString; replace: z.ZodString }>>>; summary: z.ZodOptional<z.ZodString> }>>;

  const proposeDelete = {
    name: 'propose_delete',
    description: 'Proposes deleting a page (<path>.mdx) or a folder (<path>, with every page in it). Nothing is deleted: a person sees the proposal in the Studio with what the delete takes, and accepts or rejects it. Answers the proposal and that list: the files deleted, the meta.yaml entries removed, the images deleted or kept (another note still uses them), and the notes that still link there, which the delete leaves broken: fix them with propose_edit, or say so.',
    input: z.object({
      path: z.string().min(1).describe('A page: content/notes/<path>.mdx or <path>.mdx; a folder: content/notes/<path> or <path>'),
      summary: z.string().max(2000).optional().describe('Why it should go, shown to the person'),
    }),
    access: 'write',
    async run({ path: given, summary }, ctx) {
      const deletes = await deps.deletesOf(ctx.slug);
      if (deletes === null) throw new Error('main is read only: propose in a change request');
      const at = treePath(given);
      const { proposal, plan } = await deletes.propose({ path: at, by: authorOf(ctx, deps), summary: summary ?? null });
      return json({
        id: proposal.id,
        path: at,
        state: proposal.state,
        deleted: plan.deleted,
        changes: plan.changes,
        linksLeft: plan.links,
        message: 'Nothing was deleted: a person accepts or rejects this in the Studio.',
      });
    },
  } satisfies StudioTool<z.ZodObject<{ path: z.ZodString; summary: z.ZodOptional<z.ZodString> }>>;

  const listAssetsTool: StudioTool<z.ZodObject<Record<string, never>>> = {
    name: 'list_assets',
    description: 'Lists the assets under public/notes: path, size, and the notes (with line) that use each one.',
    input: z.object({}),
    access: 'read',
    async run(_args, ctx) {
      // The list also holds the diagrams, which diagram_list answers for.
      const assets = (await listAssets(ctx.root)).filter((asset) => classifyPath(asset.path) === 'asset');
      return json({ assets: assets.map((asset) => ({ path: asset.path, size: asset.size, usedBy: asset.usages.map((usage) => ({ note: usage.note, line: usage.line })) })) });
    },
  };

  return [listNotes, readNoteTool, searchNotes, noteGraph, proposeEdit, proposeDelete, listAssetsTool] as StudioTool[];
}
