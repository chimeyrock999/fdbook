import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createKeyedLock, statOrNull, writeAtomic } from '#files/store.ts';
import { HttpError } from '#http/http.ts';
import { NOTES_DIR, resolveWorktreePath } from '#security/paths.ts';
import type { DeleteAnswer } from '#tree/delete.ts';
import type { DeleteProposal, DeleteProposalView, ProposalAuthor } from '@fdbook/shared/proposals.ts';

// The lock key proposing takes (ids are lowercase letters, digits and dashes).
const PROPOSING = 'propose:';

const newId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

// What a delete proposal needs of the worktree: a delete as the tree API
// runs it (tree/delete.ts runDelete), with `dryRun` only the plan.
export type Deleter = (request: { path: string; base?: string; dryRun?: boolean }) => Promise<DeleteAnswer>;

export type DeleteProposalsOptions = {
  // Where they are kept: a folder of the change request's proposals.
  dir: string;
  deleter: Deleter;
  // `proposed`: an author just proposed it (new, or the same path again).
  onChange?: (proposal: DeleteProposalView, proposed: boolean) => void;
};

// Whether `path` (a page or folder the tree deletes, relative to
// content/notes) is `target` or inside it.
export const within = (path: string, target: string) => path === target || path.startsWith(`${target}/`);

// Deletes an agent proposed (mcp propose_delete): one JSON file each in
// `dir`. Nothing is deleted until a person accepts, with the `base` of the
// dry run they were shown; then the delete is the tree's own. A proposal
// whose page or folder is gone otherwise shows as `gone`.
export function createDeleteProposals(root: string, { dir, deleter, onChange }: DeleteProposalsOptions) {
  const lock = createKeyedLock();
  const fileOf = (id: string) => join(dir, `${id}.json`);

  const exists = async (path: string) => {
    const resolved = resolveWorktreePath(root, path.endsWith('.mdx') ? `${NOTES_DIR}/${path}` : `${NOTES_DIR}/${path}/meta.yaml`);
    return resolved !== null && (await statOrNull(path.endsWith('.mdx') ? resolved.absolute : join(root, NOTES_DIR, path))) !== null;
  };
  const viewOf = async (proposal: DeleteProposal): Promise<DeleteProposalView> => ({
    ...proposal,
    state: proposal.decided ?? ((await exists(proposal.path)) ? 'open' : 'gone'),
  });

  async function load(id: string): Promise<DeleteProposal> {
    if (!/^[a-z0-9-]+$/.test(id)) throw new HttpError(404, `no such delete proposal: ${id}`);
    const text = await readFile(fileOf(id), 'utf8').catch(() => null);
    if (text === null) throw new HttpError(404, `no such delete proposal: ${id}`);
    return JSON.parse(text) as DeleteProposal;
  }

  async function save(proposal: DeleteProposal, proposed = false) {
    await mkdir(dir, { recursive: true });
    await writeAtomic(fileOf(proposal.id), `${JSON.stringify(proposal)}\n`);
    const view = await viewOf(proposal);
    onChange?.(view, proposed);
    return view;
  }

  async function stored(): Promise<DeleteProposal[]> {
    const names = await readdir(dir).catch(() => []);
    const read = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) =>
      readFile(join(dir, name), 'utf8').then((text) => JSON.parse(text) as DeleteProposal, () => null)));
    return read.filter((proposal) => proposal !== null).sort((a, b) => a.createdMs - b.createdMs);
  }

  return {
    async list() {
      return Promise.all((await stored()).map(viewOf));
    },

    async read(id: string) {
      return viewOf(await load(id));
    },

    // Proposes deleting the page or folder at `path`; answers the proposal
    // and the dry run a person will see. One open proposal per path: the
    // same path proposed again takes the new author and summary.
    // Proposals are made one at a time, so two at once cannot both find
    // none open for a path.
    async propose({ path, by, summary = null }: { path: string; by: ProposalAuthor; summary?: string | null }) {
      const plan = await deleter({ path, dryRun: true });
      const note = summary === null || summary.trim() === '' ? null : summary.trim().slice(0, 2000);
      const proposal = await lock(PROPOSING, async () => {
        const open = (await stored()).find((each) => each.path === path && each.decided === null);
        const next: DeleteProposal = open === undefined
          ? { id: newId(), path, by, summary: note, createdMs: Date.now(), decided: null }
          : { ...open, by, summary: note };
        return lock(next.id, () => save(next, true));
      });
      return { proposal, plan };
    },

    // Accepts with the dry run's `base` (the delete runs), or rejects. The
    // delete settles this proposal too (settle, from the tree's hook), so it
    // runs outside the proposal's lock.
    async act(id: string, op: 'accept' | 'reject', base?: unknown) {
      const proposal = await load(id);
      if (proposal.decided !== null) throw new HttpError(409, `this delete was already ${proposal.decided}`);
      if (op === 'accept') {
        if (typeof base !== 'string') throw new HttpError(400, 'base must be the one the dry run answered');
        await deleter({ path: proposal.path, base });
      }
      return lock(id, async () => {
        const now = await load(id);
        if (now.decided !== null) return viewOf(now);
        return save({ ...now, decided: op === 'accept' ? 'accepted' : 'rejected' });
      });
    },

    // A delete of `target` went through (from the tree, or another
    // proposal): the open proposals it covers are accepted with it.
    async settle(target: string) {
      for (const proposal of await stored()) {
        if (proposal.decided !== null || !within(proposal.path, target)) continue;
        await lock(proposal.id, async () => {
          // Decided meanwhile (a reject in another tab): that stands.
          const now = await load(proposal.id);
          if (now.decided === null) await save({ ...now, decided: 'accepted' });
        });
      }
    },

    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

export type DeleteProposals = ReturnType<typeof createDeleteProposals>;
