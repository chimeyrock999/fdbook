import { run } from '#cr/git.ts';
import { originRepoOf } from './check-runs.ts';

// The pull request of a change request's branch (#20).
export type PullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';
export type BranchPullRequest = { number: number; url: string; state: PullRequestState; title: string };
export type NewPullRequest = { branch: string; title: string; body: string };

// What the Studio asks of gh for one branch; tests stand in for it.
export type PullRequestGh = {
  // The branch's pull request on origin's repository, or null when it has none.
  view: (root: string, branch: string) => Promise<BranchPullRequest | null>;
  // Opens one from `branch` to main.
  create: (root: string, request: NewPullRequest) => Promise<void>;
};

const BASE = 'main';
const GH_TIMEOUT_MS = 30_000;
// Unfinished (none yet, or open) is read again sooner than finished.
const RECHECK_MS = 15_000;
const RECHECK_DONE_MS = 60_000;
// Pull requests of one branch: a few, unless it was published again and again.
const PR_LIMIT = 50;

async function repoArgs(root: string) {
  const repo = await originRepoOf(root);
  return repo === null ? [] : ['--repo', repo];
}

export const ghPullRequest: PullRequestGh = {
  // `gh pr list --head` rather than `gh pr view <branch>`: view takes a
  // fork's pull request from a branch of the same name, which is someone
  // else's. Of this repository's, the newest wins, as in the change request
  // list (server/cr/pull-requests.ts).
  async view(root, branch) {
    const output = await run(
      'gh',
      ['pr', 'list', ...(await repoArgs(root)), '--head', branch, '--state', 'all', '--limit', String(PR_LIMIT), '--json', 'number,url,state,title,isCrossRepository'],
      root,
      { timeoutMs: GH_TIMEOUT_MS },
    );
    const own = (JSON.parse(output) as (BranchPullRequest & { isCrossRepository: boolean })[]).filter((pr) => !pr.isCrossRepository);
    if (own.length === 0) return null;
    const { number, url, state, title } = own.reduce((a, b) => (b.number > a.number ? b : a));
    return { number, url, state, title };
  },
  async create(root, { branch, title, body }) {
    await run('gh', ['pr', 'create', ...(await repoArgs(root)), '--base', BASE, '--head', branch, '--title', title, '--body', body], root, { timeoutMs: GH_TIMEOUT_MS });
  },
};

type Answer = { pr: BranchPullRequest | null; error: string | null };

const ttlOf = (answer: Answer) => (answer.pr !== null && answer.pr.state !== 'OPEN' ? RECHECK_DONE_MS : RECHECK_MS);

// Reads a branch's pull request at most once every RECHECK_MS (a merged or
// closed one every RECHECK_DONE_MS); `fresh` skips the cache. gh failing
// (not installed, not logged in, offline) is an answer, not an error.
// `forget` drops what was read of a branch, after a push or a publish. The
// change request list reads all branches at once on its own cache
// (server/cr/pull-requests.ts).
export function createBranchPullRequestReader(gh: PullRequestGh, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; answer: Answer }>();
  return {
    gh,
    async read(root: string, branch: string, fresh = false): Promise<Answer> {
      for (const [key, entry] of cache) if (now() - entry.at >= ttlOf(entry.answer)) cache.delete(key);
      const cached = cache.get(branch);
      if (cached && !fresh) return cached.answer;
      let answer: Answer;
      try {
        answer = { pr: await gh.view(root, branch), error: null };
      } catch (error) {
        answer = { pr: null, error: (error as Error).message };
      }
      cache.set(branch, { at: now(), answer });
      return answer;
    },
    forget(branch: string) {
      cache.delete(branch);
    },
  };
}

export type BranchPullRequestReader = ReturnType<typeof createBranchPullRequestReader>;
