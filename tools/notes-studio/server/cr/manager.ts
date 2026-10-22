import { touchesOrigin } from '../auth/shared.ts';
import { existsSync } from 'node:fs';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createKeyedLock } from '../files/store.ts';
import { HttpError } from '../http.ts';
import type { BuildReader } from '../preview/check-runs.ts';
import { DEFAULT_STALE_DAYS } from '../config.ts';
import type { BranchPullRequestReader } from '../preview/pull-request.ts';
import { driftOf, type Drift } from './drift.ts';
import { CommandError, git, lines } from './git.ts';
import { createPullRequestReader, ghPullRequests, type ListPullRequests } from './pull-requests.ts';
import { deleteRemoteBranch, ghClosePullRequest, REMOTE, type ClosePullRequest } from './remote.ts';
import { CR_BRANCH_PREFIX, crSlug, isCrSlug } from './slug.ts';

export type CrStatus = 'draft' | 'previewing' | 'review' | 'merged' | 'closed';

export type ChangeRequest = {
  slug: string;
  name: string;
  branch: string;
  status: CrStatus;
  // Whether the branch is on the remote (as of the last fetch or push).
  pushed: boolean;
  // Null while the branch has no worktree; opening the change request adds one.
  worktree: string | null;
  // Notes (.mdx under content/notes) changed against origin/main, committed or not.
  changedPages: number;
  // Files with changes not committed yet, anywhere in the worktree.
  uncommitted: number;
  updatedMs: number;
  previewUrl: string | null;
  pr: { number: number; url: string } | null;
  // Open (Draft, Previewing, In review) and not updated for `staleDays`.
  stale: boolean;
  // Against origin/main as last fetched; null once merged or closed.
  drift: Drift | null;
};

// What the dry run said about origin, sent back with the discard it confirms.
export type DiscardSeen = { pushed: boolean; closesPr: number | null };

// What a discard removes, from the dry run that the dialog shows. `pushed`:
// the branch on origin goes too; `closesPr`: the open pull request is closed
// first; `unpushed`: commits of a pushed branch that origin does not have;
// `prError`: why gh could not read the pull requests, which blocks the
// discard of a pushed branch (its pull request would close unannounced).
export type Discard = {
  slug: string;
  branch: string;
  status: CrStatus;
  worktree: string | null;
  commits: number;
  uncommitted: number;
  pushed: boolean;
  unpushed: number;
  pr: { number: number; url: string } | null;
  closesPr: { number: number; url: string } | null;
  prError: string | null;
};

export type ChangeRequestOptions = {
  // The git repository the branches are made in.
  repo: string;
  // Holds worktrees/: `_main`, the read-only checkout of origin/main, and one per change request.
  home: string;
  pullRequests?: ListPullRequests;
  // The Cloudflare Pages project, for the preview links.
  pagesProject?: string | null;
  // Reads the preview builds (server/preview); gh unless a test stands in.
  builds?: BuildReader;
  // Reads and opens a branch's pull request (server/preview); gh unless a test stands in.
  branchPullRequests?: BranchPullRequestReader;
  closePullRequest?: ClosePullRequest;
  // STUDIO_STALE_DAYS.
  staleDays?: number;
};

const BASE = `${REMOTE}/main`;
// Not a slug (slugs start with a letter or digit), so no change request takes it.
const MAIN_DIR = '_main';
const NAME_MAX = 80;
const NOTES = 'content/notes/';
const DAY_MS = 24 * 3600_000;

const branchOf = (slug: string) => `${CR_BRANCH_PREFIX}${slug}`;

// The preview Cloudflare Pages builds for a branch: its name lowercased,
// anything but letters and digits as `-`, at most 28 characters.
export function previewUrlOf(branch: string, project: string) {
  const alias = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28).replace(/-+$/, '');
  return `https://${alias}.${project}.pages.dev`;
}

// The paths in `git status --porcelain=v1 -z`; a rename or copy names two.
function statusPaths(output: string) {
  const parts = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  return paths;
}

type Worktree = { path: string; branch: string | null };

// `git worktree list --porcelain`: blocks of `worktree <path>` and `branch
// refs/heads/<name>`. A worktree whose folder is gone (removed by hand while
// the Studio runs: git marks it `prunable`) is left out, as if pruned.
function parseWorktrees(output: string): Worktree[] {
  return output.split('\n\n').flatMap((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path === undefined || /^prunable/m.test(block) || !existsSync(path)) return [];
    return [{ path, branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null }];
  });
}

// Change requests: a branch cr/<slug> from origin/main with its worktree in
// `home`, and the read-only worktree of origin/main the Studio opens first.
// Git holds all of it: the name is the branch description, the creation
// time a `studiocreated` key in the branch's config, the status the remote
// branch and the pull request (gh). Opens `_main` (fetching origin) and
// prunes worktrees that were removed by hand.
export async function openChangeRequests({
  repo,
  home,
  pullRequests = ghPullRequests(repo),
  pagesProject = null,
  closePullRequest = ghClosePullRequest(repo),
  staleDays = DEFAULT_STALE_DAYS,
}: ChangeRequestOptions) {
  const worktrees = join(home, 'worktrees');
  await mkdir(worktrees, { recursive: true });
  // As git prints it, so the paths it lists compare equal (macOS's /var is /private/var).
  const root = await realpath(worktrees);
  const mainRoot = join(root, MAIN_DIR);
  const dirOf = (slug: string) => join(root, slug);
  const readPullRequests = createPullRequestReader(pullRequests);
  // Creating, discarding and adding worktrees run one at a time.
  const lock = createKeyedLock();
  const inRepo = (...args: string[]) => git(repo, ...args);
  let beforeDiscard: (slug: string) => Promise<void> = () => Promise.resolve();

  const listWorktrees = async () => parseWorktrees(await inRepo('worktree', 'list', '--porcelain'));
  const branchSlugs = async () =>
    lines(await inRepo('for-each-ref', '--format=%(refname:short)', `refs/heads/${CR_BRANCH_PREFIX}`))
      .map((branch) => branch.slice(CR_BRANCH_PREFIX.length))
      .filter(isCrSlug);

  const remoteRefs = async () => lines(await inRepo('for-each-ref', '--format=%(refname:short)', `refs/remotes/${REMOTE}/${CR_BRANCH_PREFIX}`));
  const remoteSlugs = async () => (await remoteRefs()).map((ref) => ref.slice(`${REMOTE}/${CR_BRANCH_PREFIX}`.length));

  // branch.cr/<slug>.<key> values by slug; none set is not an error.
  async function branchConfig() {
    let output = '';
    try {
      output = await inRepo('config', '--get-regexp', `^branch\\.${CR_BRANCH_PREFIX}`);
    } catch (error) {
      if (!(error instanceof CommandError && error.code === 1)) throw error;
    }
    const config = new Map<string, Map<string, string>>();
    for (const line of lines(output)) {
      const space = line.indexOf(' ');
      const key = space === -1 ? line : line.slice(0, space);
      const dot = key.lastIndexOf('.');
      const slug = key.slice(`branch.${CR_BRANCH_PREFIX}`.length, dot);
      if (!config.has(slug)) config.set(slug, new Map());
      config.get(slug)?.set(key.slice(dot + 1), space === -1 ? '' : line.slice(space + 1));
    }
    return config;
  }

  async function changesIn(worktree: string) {
    const [committed, status, last] = await Promise.all([
      // No merge base (a history unrelated to main): count what is uncommitted only.
      git(worktree, 'diff', '--name-only', '-z', `${BASE}...HEAD`).catch(() => ''),
      git(worktree, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
      git(worktree, 'log', '-1', '--format=%ct', `${BASE}..HEAD`),
    ]);
    const dirty = statusPaths(status);
    const pages = new Set([...committed.split('\0'), ...dirty].filter((path) => path.startsWith(NOTES) && path.endsWith('.mdx')));
    const mtimes = await Promise.all(dirty.map((path) => stat(join(worktree, path)).then((info) => info.mtimeMs, () => 0)));
    const updatedMs = Math.max(last.trim() === '' ? 0 : Number(last.trim()) * 1000, ...mtimes);
    return { changedPages: pages.size, uncommitted: dirty.length, updatedMs };
  }

  // main and every cr/* branch on origin, dropping the remote refs of
  // branches deleted there (a merged pull request's, say), so pushed and the
  // taken slugs follow the remote.
  const fetchOrigin = () =>
    inRepo('fetch', '--quiet', '--prune', REMOTE, `+refs/heads/main:refs/remotes/${BASE}`, `+refs/heads/${CR_BRANCH_PREFIX}*:refs/remotes/${REMOTE}/${CR_BRANCH_PREFIX}*`);

  // The slugs a new change request cannot take: local and remote cr/*
  // branches, the heads of past pull requests (a new branch of that name
  // would show their status) and the folders in `home`.
  async function takenSlugs() {
    const [local, remote, prs, folders] = await Promise.all([branchSlugs(), remoteSlugs(), readPullRequests(), readdir(root)]);
    const heads = [...prs.byBranch.keys()].map((branch) => branch.slice(CR_BRANCH_PREFIX.length));
    return [...new Set([...local, ...remote, ...heads, ...folders])].filter(isCrSlug).sort();
  }

  // The last commit on a branch past main, for one without a worktree.
  async function lastCommitMs(branch: string) {
    const last = (await inRepo('log', '-1', '--format=%ct', `${BASE}..${branch}`)).trim();
    return last === '' ? 0 : Number(last) * 1000;
  }

  // Fetches origin and checks main out again, one at a time with creating
  // and discarding. Answers why the fetch failed, or null.
  function refresh(): Promise<string | null> {
    return lock('cr', async () => {
      try {
        await fetchOrigin();
      } catch (error) {
        return (error as Error).message;
      }
      await refreshMain().catch(() => undefined);
      return null;
    });
  }

  // Every change request, the last updated first, and the slugs taken.
  // `prError` says why the pull requests could not be read; the statuses
  // then come from git alone. `fresh` fetches origin first and reads the
  // pull requests again; `fetchError` says why that fetch failed.
  async function list(fresh = false): Promise<{ crs: ChangeRequest[]; taken: string[]; prError: string | null; fetchError: string | null }> {
    const fetchError = fresh ? await refresh() : null;
    const [slugs, remote, config, trees, prs] = await Promise.all([
      branchSlugs(),
      remoteRefs(),
      branchConfig(),
      listWorktrees(),
      readPullRequests(fresh),
    ]);
    const pushed = new Set(remote.map((ref) => ref.slice(REMOTE.length + 1)));
    const crs = await Promise.all(
      slugs.map(async (slug): Promise<ChangeRequest> => {
        const branch = branchOf(slug);
        const worktree = trees.find((tree) => tree.branch === branch)?.path ?? null;
        const created = Number(config.get(slug)?.get('studiocreated') ?? 0) || 0;
        const changes = worktree === null ? { changedPages: 0, uncommitted: 0, updatedMs: await lastCommitMs(branch) } : await changesIn(worktree);
        const pr = prs.byBranch.get(branch) ?? null;
        const isPushed = pushed.has(branch);
        const status: CrStatus =
          pr?.state === 'MERGED' ? 'merged' : pr?.state === 'CLOSED' ? 'closed' : pr?.state === 'OPEN' ? 'review' : isPushed ? 'previewing' : 'draft';
        const open = status !== 'merged' && status !== 'closed';
        const updatedMs = Math.max(created, changes.updatedMs);
        return {
          slug,
          name: config.get(slug)?.get('description') ?? slug,
          branch,
          status,
          pushed: isPushed,
          worktree,
          ...changes,
          updatedMs,
          previewUrl: isPushed && pagesProject ? previewUrlOf(branch, pagesProject) : null,
          pr: pr === null ? null : { number: pr.number, url: pr.url },
          stale: open && Date.now() - updatedMs > staleDays * DAY_MS,
          // One that cannot be read (unrelated history, say) does not stop the list.
          drift: open ? await driftOf(repo, branch, BASE).catch(() => null) : null,
        };
      }),
    );
    return { crs: crs.sort((a, b) => b.updatedMs - a.updatedMs), taken: await takenSlugs(), prError: prs.error, fetchError };
  }

  // `_main` at origin/main as it is now. Nothing writes there, so a forced
  // checkout loses nothing.
  async function refreshMain() {
    if ((await listWorktrees()).some((tree) => tree.path === mainRoot)) {
      await git(mainRoot, 'checkout', '--quiet', '--detach', '--force', BASE);
      return;
    }
    await rm(mainRoot, { recursive: true, force: true });
    await inRepo('worktree', 'add', '--quiet', '--detach', mainRoot, BASE);
  }

  async function create(value: unknown): Promise<ChangeRequest> {
    if (typeof value !== 'string') throw new HttpError(400, 'name must be a string');
    const name = value.replace(/\s+/g, ' ').trim();
    if (name === '') throw new HttpError(400, 'Give the change request a name.');
    if (name.length > NAME_MAX) throw new HttpError(400, `The name is longer than ${String(NAME_MAX)} characters.`);
    return lock('cr', async () => {
      if (crSlug(name) === null) throw new HttpError(400, 'The name needs a letter or a digit.');
      try {
        await fetchOrigin();
      } catch (error) {
        throw new HttpError(502, `Could not fetch ${BASE}: ${(error as Error).message}`);
      }
      // After the fetch, so a branch just pushed elsewhere counts.
      const slug = crSlug(name, new Set(await takenSlugs())) ?? '';
      const branch = branchOf(slug);
      // --no-track: the branch must not push to main.
      await inRepo('worktree', 'add', '--quiet', '--no-track', '-b', branch, dirOf(slug), BASE);
      await inRepo('config', `branch.${branch}.description`, name);
      await inRepo('config', `branch.${branch}.studiocreated`, String(Date.now()));
      // Reading main follows the fetch too.
      await refreshMain().catch(() => undefined);
      const created = (await list()).crs.find((cr) => cr.slug === slug);
      if (!created) throw new Error(`created ${branch} but cannot read it back`);
      return created;
    });
  }

  // Removes the change request: on origin first, closing its open pull
  // request and deleting its branch there, then from this machine, its
  // worktree (with what was not committed) and its local branch. When origin
  // or gh refuses, nothing is removed. A merged or closed one is cleaned up
  // the same way. Fetches first, so what origin has is current. With
  // `dryRun`, only says what goes. `seen` is what the dry run the user
  // confirmed said about origin: when origin has changed since, nothing is
  // removed, so the discard never touches what the dialog did not list.
  // Without `onOrigin` (a writer, not an admin) a discard that would close a
  // pull request or delete a branch on origin is refused.
  async function discard(slug: string, dryRun: boolean, seen: DiscardSeen | null = null, onOrigin = true): Promise<Discard> {
    return lock('cr', async () => {
      if (!isCrSlug(slug)) throw new HttpError(404, `no such change request: ${slug}`);
      // Offline: go by the last fetch; deleting the remote branch then fails.
      await fetchOrigin().catch(() => undefined);
      // The pull request's state decides whether to close it: read it now.
      const prs = await readPullRequests(true);
      const cr = (await list()).crs.find((each) => each.slug === slug);
      if (!cr) throw new HttpError(404, `no such change request: ${slug}`);
      const count = async (...revs: string[]) => Number((await inRepo('rev-list', '--count', ...revs)).trim());
      const answer: Discard = {
        slug,
        branch: cr.branch,
        status: cr.status,
        worktree: cr.worktree,
        commits: await count(`${BASE}..${cr.branch}`),
        uncommitted: cr.uncommitted,
        pushed: cr.pushed,
        unpushed: cr.pushed ? await count(cr.branch, '--not', `refs/remotes/${REMOTE}/${cr.branch}`) : 0,
        pr: cr.pr,
        closesPr: cr.status === 'review' ? cr.pr : null,
        prError: cr.pushed ? prs.error : null,
      };
      if (dryRun) return answer;
      if (!onOrigin && touchesOrigin(cr)) {
        throw new HttpError(403, `${cr.branch} is on ${REMOTE}: cleaning it up there needs admin access to the repository. Nothing was removed.`);
      }
      if (answer.prError !== null) {
        throw new HttpError(502, `Could not read the pull requests: ${answer.prError.replace(/\.?$/, '.')} Nothing was removed.`);
      }
      if (seen !== null && (seen.pushed !== answer.pushed || seen.closesPr !== (answer.closesPr?.number ?? null))) {
        throw new HttpError(409, `${cr.branch} changed on ${REMOTE} since this was checked. Nothing was removed: look again before discarding.`);
      }
      const reason = (error: unknown) => (error as Error).message.replace(/\.?$/, '.');
      try {
        if (answer.closesPr !== null) await closePullRequest(answer.closesPr.number);
      } catch (error) {
        throw new HttpError(502, `Could not close pull request #${String(answer.closesPr?.number)}: ${reason(error)} Nothing was removed.`);
      }
      try {
        if (answer.pushed) await deleteRemoteBranch(repo, cr.branch);
      } catch (error) {
        const closed = answer.closesPr === null ? '' : `Pull request #${String(answer.closesPr.number)} was closed, but `;
        throw new HttpError(502, `${closed}${closed ? 'the' : 'The'} branch on ${REMOTE} could not be deleted: ${reason(error)} Nothing was removed from this machine.`);
      }
      await beforeDiscard(slug);
      if (cr.worktree !== null) await inRepo('worktree', 'remove', '--force', cr.worktree);
      await rm(dirOf(slug), { recursive: true, force: true });
      await inRepo('worktree', 'prune');
      await inRepo('branch', '-D', cr.branch);
      return answer;
    });
  }

  // The worktree of a change request, added again if it was removed; null
  // when there is no such branch.
  function worktreeOf(slug: string): Promise<string | null> {
    if (!isCrSlug(slug)) return Promise.resolve(null);
    return lock('cr', async () => {
      if (!(await branchSlugs()).includes(slug)) return null;
      const found = (await listWorktrees()).find((tree) => tree.branch === branchOf(slug));
      if (found) return found.path;
      // A worktree removed by hand is still registered until pruned.
      await inRepo('worktree', 'prune');
      await rm(dirOf(slug), { recursive: true, force: true });
      await inRepo('worktree', 'add', '--quiet', dirOf(slug), branchOf(slug));
      return dirOf(slug);
    });
  }

  await inRepo('worktree', 'prune');
  try {
    await fetchOrigin();
  } catch (error) {
    // Offline: read the origin/main this clone already has.
    console.warn(`Notes Studio could not fetch ${BASE}, reading the last one fetched: ${(error as Error).message}`);
  }
  try {
    await refreshMain();
  } catch (error) {
    throw new Error(`Notes Studio reads ${BASE} and could not check it out: ${(error as Error).message}`, { cause: error });
  }

  return {
    mainRoot,
    list,
    create,
    discard,
    worktreeOf,
    // Runs before a discard removes the worktree: the server closes what it opened there.
    onDiscard(callback: (slug: string) => Promise<void>) {
      beforeDiscard = callback;
    },
  };
}

export type ChangeRequests = Awaited<ReturnType<typeof openChangeRequests>>;
