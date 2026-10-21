import { run } from './git.ts';
import { CR_BRANCH_PREFIX } from './slug.ts';

export type PullRequest = { number: number; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; headRefName: string };
// The pull requests of the cr/* branches by branch name, or why they could
// not be read (no gh, not logged in, offline).
export type PullRequests = { byBranch: Map<string, PullRequest>; error: string | null };
export type ListPullRequests = () => Promise<PullRequest[]>;

const CACHE_MS = 30_000;

// The newest pull requests `gh pr list` reads, of every state. A change
// request whose pull request is older than that many reads as Previewing.
const PR_LIMIT = 1000;

// `gh pr list` over every state, keeping the cr/* heads of this repository
// (a fork's branch of the same name is someone else's). One call for all
// change requests; the newest PR of a branch wins.
export function ghPullRequests(repo: string): ListPullRequests {
  return async () => {
    const output = await run('gh', ['pr', 'list', '--state', 'all', '--limit', String(PR_LIMIT), '--json', 'number,url,state,headRefName,isCrossRepository'], repo);
    return (JSON.parse(output) as (PullRequest & { isCrossRepository: boolean })[])
      .filter((pr) => !pr.isCrossRepository && pr.headRefName.startsWith(CR_BRANCH_PREFIX))
      .map(({ number, url, state, headRefName }) => ({ number, url, state, headRefName }));
  };
}

// Reads the pull requests at most once every CACHE_MS; `fresh` skips the cache.
export function createPullRequestReader(list: ListPullRequests) {
  let cached: { at: number; value: PullRequests } | null = null;
  return async (fresh = false): Promise<PullRequests> => {
    if (!fresh && cached !== null && Date.now() - cached.at < CACHE_MS) return cached.value;
    let value: PullRequests;
    try {
      const byBranch = new Map<string, PullRequest>();
      for (const pr of [...(await list())].sort((a, b) => a.number - b.number)) byBranch.set(pr.headRefName, pr);
      value = { byBranch, error: null };
    } catch (error) {
      value = { byBranch: new Map(), error: (error as Error).message };
    }
    cached = { at: Date.now(), value };
    return value;
  };
}
