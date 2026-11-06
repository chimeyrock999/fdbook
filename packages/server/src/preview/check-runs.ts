import { run } from '#cr/git.ts';

// The check run Cloudflare Pages posts on every commit it builds, pushed with
// or without a pull request (#7). It is how the Studio follows a preview:
// gh reads it, so no Cloudflare token is needed.
export const CHECK_NAME = 'Cloudflare Pages';

export type CheckRun = {
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
};
// The newest Cloudflare Pages check run on `sha`, or null when there is none.
export type ReadCheckRun = (root: string, sha: string) => Promise<CheckRun | null>;

export type BuildState = 'waiting' | 'building' | 'ready' | 'failed' | 'skipped' | 'none' | 'unknown';
export type Build = {
  state: BuildState;
  // The build's log in the Cloudflare dashboard.
  logUrl: string | null;
  // This build's own URL, and the branch's, which shows its last successful build.
  deploymentUrl: string | null;
  aliasUrl: string | null;
  // When it finished, or started while it runs.
  at: string | null;
  // Why the build could not be read (state `unknown`).
  error: string | null;
};

// Cloudflare starts a build within a minute of a push; one that has not
// shown up after this was skipped (a push outside its watch paths or
// branches leaves no check run at all).
export const NO_BUILD_AFTER_MS = 3 * 60_000;
const RECHECK_MS = 10_000;
// A finished build is read again now and then: Cloudflare can retry one on the same commit.
const RECHECK_DONE_MS = 60_000;
const GH_TIMEOUT_MS = 20_000;

type GhCheckRun = {
  id: number;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  output: { summary: string | null } | null;
};

// The GitHub repository of a remote URL (ssh, scp-like or https), or null.
export function githubRepoOf(url: string) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;
}

// The GitHub repository of origin, where the Studio pushes, or null when
// origin is not on GitHub (gh then picks from the worktree's remotes).
export async function originRepoOf(root: string) {
  return githubRepoOf(await run('git', ['remote', 'get-url', 'origin'], root).catch(() => ''));
}

// `gh api` on origin's repository; gh's own pick ({owner}/{repo}) only when
// origin is not on GitHub.
export const ghCheckRun: ReadCheckRun = async (root, sha) => {
  const repo = (await originRepoOf(root)) ?? '{owner}/{repo}';
  const output = await run('gh', ['api', `repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}`], root, { timeoutMs: GH_TIMEOUT_MS });
  const runs = (JSON.parse(output) as { check_runs: GhCheckRun[] }).check_runs;
  if (runs.length === 0) return null;
  const newest = runs.reduce((a, b) => (b.id > a.id ? b : a));
  return {
    status: newest.status,
    conclusion: newest.conclusion,
    detailsUrl: newest.details_url,
    summary: newest.output?.summary ?? null,
    startedAt: newest.started_at,
    completedAt: newest.completed_at,
  };
};

const PAGES_URL = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev\/?$/;

// The two links in the summary's table: "Preview URL" (this deployment) and
// "Branch Preview URL" (the branch alias). Anything but a pages.dev URL is
// not taken.
export function parseSummary(summary: string | null) {
  const link = (label: string) => {
    const href = new RegExp(`<strong>${label}:</strong>[\\s\\S]*?href='([^']+)'`).exec(summary ?? '')?.[1];
    return href !== undefined && PAGES_URL.test(href) ? href.replace(/\/$/, '') : null;
  };
  return { deploymentUrl: link('Preview URL'), aliasUrl: link('Branch Preview URL') };
}

const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure']);

// The build of a pushed commit, from its check run. With none yet, it is
// waiting until NO_BUILD_AFTER_MS after the push, then there is no build. A
// run that finished neither succeeding nor failing (`neutral`, `skipped`)
// built nothing new: skipped.
export function buildOf(check: CheckRun | null, pushedMs: number, now: number): Build {
  const nothing = { logUrl: null, deploymentUrl: null, aliasUrl: null, at: null, error: null };
  if (check === null) return { state: now - pushedMs < NO_BUILD_AFTER_MS ? 'waiting' : 'none', ...nothing };
  const state: BuildState =
    check.status !== 'completed' ? 'building' : check.conclusion === 'success' ? 'ready' : FAILED.has(check.conclusion ?? '') ? 'failed' : 'skipped';
  return { state, logUrl: check.detailsUrl, ...parseSummary(check.summary), at: check.completedAt ?? check.startedAt, error: null };
}

type Answer = { run: CheckRun | null; error: string | null };

const ttlOf = (answer: Answer) => (answer.run?.status === 'completed' ? RECHECK_DONE_MS : RECHECK_MS);

// Reads check runs at most once every RECHECK_MS per commit, and a finished
// one every RECHECK_DONE_MS. gh failing (not installed, not logged in,
// offline) is an answer, not an error. Answers past their time are dropped.
export function createBuildReader(read: ReadCheckRun, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; answer: Answer }>();
  return {
    now,
    async read(root: string, sha: string): Promise<Answer> {
      for (const [key, entry] of cache) if (now() - entry.at >= ttlOf(entry.answer)) cache.delete(key);
      const cached = cache.get(sha);
      if (cached) return cached.answer;
      let answer: Answer;
      try {
        answer = { run: await read(root, sha), error: null };
      } catch (error) {
        answer = { run: null, error: (error as Error).message };
      }
      cache.set(sha, { at: now(), answer });
      return answer;
    },
    // A commit just pushed: what was read of it before is stale.
    pushed(sha: string) {
      cache.delete(sha);
    },
  };
}

export type BuildReader = ReturnType<typeof createBuildReader>;
