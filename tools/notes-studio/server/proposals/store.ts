import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createKeyedLock, writeAtomic } from '../files/store.ts';
import { createStudioFiles, FileConflictError } from '../files/studio-files.ts';
import { HttpError } from '../http.ts';
import { classifyPath } from '../security/paths.ts';
import { applyAt, blocksOf, hunksOf, placeOf, rebased, type Block } from './hunks.ts';
import type { Proposal, ProposalAuthor, ProposalHunk, ProposalOp, ProposalView, StoredHunk } from './shared.ts';

// The most text one proposal may carry, and the most find/replace edits.
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_EDITS = 100;

const newId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

export type Edit = { find: string; replace: string };

// `source` with each `find` (which must be there exactly once, in the
// note as it is) replaced.
export function applyEdits(source: string, edits: Edit[]) {
  let result = source;
  for (const [index, { find, replace }] of edits.entries()) {
    if (find === '') throw new HttpError(400, `edit ${String(index + 1)}: find must not be empty`);
    const at = result.indexOf(find);
    if (at === -1) throw new HttpError(409, `edit ${String(index + 1)}: its find text is not in the note`);
    if (result.includes(find, at + 1)) throw new HttpError(409, `edit ${String(index + 1)}: its find text is in the note more than once; give more of it`);
    result = result.slice(0, at) + replace + result.slice(at + find.length);
  }
  return result;
}

function parsed(source: string, what: string): Block[] {
  try {
    return blocksOf(source);
  } catch (error) {
    throw new HttpError(422, `${what} does not parse: ${(error as Error).message}`);
  }
}

// Each hunk against the note as it is now.
function viewOf(proposal: Proposal, note: { content: string; mtimeMs: number } | null): ProposalView {
  let blocks: Block[] | null = null;
  if (note !== null) {
    try {
      blocks = blocksOf(note.content);
    } catch {
      // A note that does not parse now holds no place for any hunk.
    }
  }
  const hunks = proposal.hunks.map((hunk): ProposalHunk => {
    if (hunk.decided !== null) return { ...hunk, state: hunk.decided, from: null, to: null };
    const place = note === null || blocks === null ? null : placeOf(hunk, note.content, blocks);
    return { ...hunk, state: place === null ? 'stale' : 'open', from: place?.from ?? null, to: place?.to ?? null };
  });
  return { ...proposal, hunks, mtimeMs: note?.mtimeMs ?? null, stale: hunks.some((hunk) => hunk.state === 'stale'), done: hunks.every((hunk) => hunk.decided !== null) };
}

export type ProposalsOptions = {
  // Where this change request's proposals are kept, outside its worktree.
  dir: string;
  // The worktree's notes lock and the file API's path lock (workspace.ts).
  notesLock?: ReturnType<typeof createKeyedLock>;
  pathLock?: ReturnType<typeof createKeyedLock>;
  // Told each time a proposal is made or changed.
  onChange?: (proposal: ProposalView) => void;
};

// The proposals of one change request: edits to its notes that wait for a
// person, one JSON file each in `dir`. A proposal never touches the note
// until a hunk of it is accepted; then that hunk is written where it
// applies now, under the notes lock, from the mtime it was read at.
export function createProposals(root: string, { dir, notesLock = createKeyedLock(), pathLock = createKeyedLock(), onChange }: ProposalsOptions) {
  const files = createStudioFiles(root, { notesLock, pathLock });
  // One change to a proposal at a time.
  const lock = createKeyedLock();
  const fileOf = (id: string) => join(dir, `${id}.json`);

  const note = (path: string) => files.read(path);

  async function load(id: string): Promise<Proposal> {
    if (!/^[a-z0-9-]+$/.test(id)) throw new HttpError(404, `no such proposal: ${id}`);
    const text = await readFile(fileOf(id), 'utf8').catch(() => null);
    if (text === null) throw new HttpError(404, `no such proposal: ${id}`);
    return JSON.parse(text) as Proposal;
  }

  async function save(proposal: Proposal) {
    await mkdir(dir, { recursive: true });
    await writeAtomic(fileOf(proposal.id), `${JSON.stringify(proposal)}\n`);
    const view = viewOf(proposal, await note(proposal.path));
    onChange?.(view);
    return view;
  }

  async function list(path?: string): Promise<ProposalView[]> {
    const names = await readdir(dir).catch(() => []);
    const proposals = (await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) =>
      readFile(join(dir, name), 'utf8').then((text) => JSON.parse(text) as Proposal, () => null),
    ))).filter((proposal) => proposal !== null && (path === undefined || proposal.path === path)) as Proposal[];
    // One read of each note, however many proposals it has.
    const notes = new Map<string, Promise<{ content: string; mtimeMs: number } | null>>();
    for (const proposal of proposals) if (!notes.has(proposal.path)) notes.set(proposal.path, note(proposal.path).catch(() => null));
    const views = await Promise.all(proposals.map(async (proposal) => viewOf(proposal, await notes.get(proposal.path) ?? null)));
    return views.sort((a, b) => a.createdMs - b.createdMs);
  }

  return {
    list,

    async read(id: string) {
      const proposal = await load(id);
      return viewOf(proposal, await note(proposal.path));
    },

    // A proposal for the note at `path`: its whole new text (`content`) or
    // find/replace `edits` on it as it is now. It must parse and change
    // something; nothing is written to the note.
    async propose({ path, content, edits, by, summary = null }: { path: string; content?: string | undefined; edits?: Edit[] | undefined; by: ProposalAuthor; summary?: string | null }) {
      if (classifyPath(path) !== 'note') throw new HttpError(403, `only notes take proposals (content/notes/**/*.mdx): ${path}`);
      if ((content === undefined) === (edits === undefined)) throw new HttpError(400, 'give either content or edits');
      if (edits !== undefined && (edits.length === 0 || edits.length > MAX_EDITS)) throw new HttpError(400, `give 1 to ${String(MAX_EDITS)} edits`);
      const current = await note(path);
      if (current === null) throw new HttpError(404, `no such note: ${path} (a proposal edits a note that exists)`);
      const next = content ?? applyEdits(current.content, edits ?? []);
      if (Buffer.byteLength(next) > MAX_NOTE_BYTES) throw new HttpError(413, `the note would be larger than ${String(MAX_NOTE_BYTES)} bytes`);
      parsed(current.content, `${path} as it is now`);
      parsed(next, 'the proposed note');
      const hunks = hunksOf(current.content, next);
      if (hunks.length === 0) throw new HttpError(409, 'the proposed note is the same as the note');
      const proposal: Proposal = {
        id: newId(),
        path,
        by,
        summary: summary === null || summary.trim() === '' ? null : summary.trim().slice(0, 2000),
        createdMs: Date.now(),
        hunks: hunks.map((hunk, index): StoredHunk => ({ id: String(index + 1), ...hunk, decided: null })),
      };
      // `text`: the note as proposed, for checks of the caller's own.
      return { ...(await lock(proposal.id, () => save(proposal))), text: next };
    },

    // Accepts, rejects, rebases or drops the hunks named (all undecided
    // ones by default). Accepting a stale hunk is refused: rebase it first.
    act(id: string, op: ProposalOp, hunkIds?: string[]) {
      return lock(id, async () => {
        const proposal = await load(id);
        const chosen = proposal.hunks.filter((hunk) => hunk.decided === null && (hunkIds === undefined || hunkIds.includes(hunk.id)));
        const unknown = (hunkIds ?? []).filter((hunkId) => !proposal.hunks.some((hunk) => hunk.id === hunkId));
        if (unknown.length > 0) throw new HttpError(404, `no such hunk: ${unknown.join(', ')}`);
        if (chosen.length === 0) throw new HttpError(409, 'nothing left to decide in these hunks');
        if (op === 'reject' || op === 'drop') {
          for (const hunk of chosen) hunk.decided = op === 'reject' ? 'rejected' : 'dropped';
          return save(proposal);
        }
        const current = await note(proposal.path);
        if (current === null) throw new HttpError(409, `${proposal.path} is gone: drop the proposal`);
        const blocks = parsed(current.content, `${proposal.path} as it is now`);
        if (op === 'rebase') {
          for (const hunk of chosen) {
            if (placeOf(hunk, current.content, blocks) !== null) continue;
            const moved = rebased(hunk, current.content, blocks);
            if (moved === null) throw new HttpError(409, `hunk ${hunk.id}: the blocks around it are gone, so it cannot be rebased; drop it`);
            Object.assign(hunk, { removed: moved.removed, count: moved.count, index: moved.index });
          }
          return save(proposal);
        }
        const edits = chosen.map((hunk) => {
          const place = placeOf(hunk, current.content, blocks);
          if (place === null) throw new HttpError(409, `hunk ${hunk.id} is stale: the note changed there since; rebase or drop it`);
          return { place, added: hunk.added };
        });
        // Repeated blocks can lead two hunks to one stretch: never both.
        const sorted = [...edits].sort((x, y) => x.place.from - y.place.from);
        if (sorted.some((edit, index) => index > 0 && edit.place.from < sorted[index - 1].place.to)) {
          throw new HttpError(409, 'these hunks now fall on the same text: accept them one at a time');
        }
        const next = applyAt(current.content, edits);
        parsed(next, 'the note with only these hunks accepted');
        try {
          await files.write(proposal.path, next, { baseMtime: current.mtimeMs });
        } catch (error) {
          if (error instanceof FileConflictError) throw new HttpError(409, `${proposal.path} changed while accepting: try again`);
          throw error;
        }
        for (const hunk of chosen) hunk.decided = 'accepted';
        return save(proposal);
      });
    },

    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

export type Proposals = ReturnType<typeof createProposals>;
