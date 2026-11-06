import { HttpError } from '#infra/http.ts';
import { CommandError, git, run } from '#infra/command.ts';
import { CR_BRANCH_PREFIX } from '@fdbook/shared/cr-slug.ts';
import { loadChanges } from '#services/git/status.ts';
import { buildOf, type Build, type BuildReader } from './check-runs.ts';
import type { BranchPullRequest, BranchPullRequestReader } from './pull-request.ts';

// What the Preview section shows for a worktree (#19).
export type Preview = {
  branch: string | null;
  // Why this worktree cannot be previewed, or null.
  blocked: string | null;
  // The branch's head on origin, as of the last fetch or push.
  pushed: { sha: string } | null;
  // The commits a push would send, newest first.
  unpushed: string[];
  // Files changed and not committed: not in the preview.
  uncommitted: number;
  // The branch's preview: Cloudflare's alias, else the one read off the branch.
  url: string | null;
  // The build of the pushed head; null until the branch is pushed.
  build: Build | null;
  // The branch's pull request (#20), and why it could not be read.
  pr: BranchPullRequest | null;
  prError: string | null;
};

// The preview Cloudflare Pages builds for a branch: its name lowercased,
// anything but letters and digits as `-`, at most 28 characters.
export function previewUrlOf(branch: string, project: string) {
  const alias = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28).replace(/-+$/, '');
  return `https://${alias}.${project}.pages.dev`;
}

export type PreviewOptions = { builds: BuildReader; pullRequests: BranchPullRequestReader; pagesProject: string | null };

const REMOTE = 'origin';
const PUSH_TIMEOUT_MS = 120_000;
const LIMIT = 200;

// When the branch on origin last moved here (a push, or the fetch that saw
// one): the remote ref's reflog, which outlives the server. Without one, the
// commit's own time.
async function pushedAt(root: string, remoteRef: string, sha: string) {
  const entry = await git(root, 'reflog', '-1', '--date=unix', '--format=%gd', remoteRef).catch(() => '');
  const seconds = /@\{(\d+)\}/.exec(entry)?.[1] ?? (await git(root, 'log', '-1', '--format=%ct', sha)).trim();
  return Number(seconds) * 1000;
}

export const blockedOnly = (branch: string | null, blocked: string): Preview => ({
  branch,
  blocked,
  pushed: null,
  unpushed: [],
  uncommitted: 0,
  url: null,
  build: null,
  pr: null,
  prError: null,
});

// The preview of the change request checked out in `root`: what is pushed,
// what is not yet, the build Cloudflare Pages made of the pushed head, and
// the branch's pull request (read fresh with `freshPr`).
export async function loadPreview(root: string, { builds, pullRequests, pagesProject }: PreviewOptions, { freshPr = false } = {}): Promise<Preview> {
  const { branch, files } = await loadChanges(root);
  if (branch === null) return blockedOnly(branch, 'HEAD is detached: preview a change request.');
  if (!branch.startsWith(CR_BRANCH_PREFIX)) return blockedOnly(branch, `Only change requests (${CR_BRANCH_PREFIX}…) get a preview.`);
  // Read whether pushed or not (a merged pull request's branch can be gone
  // from origin), alongside the build: both can wait on gh.
  const pullRequest = pullRequests.read(root, branch, freshPr);
  const remoteRef = `refs/remotes/${REMOTE}/${branch}`;
  const pushedSha = (await git(root, 'rev-parse', '--verify', '--quiet', remoteRef).catch(() => '')).trim();
  // What a push sends: the commits past the branch on origin, or past main
  // for a branch not pushed yet.
  const since = pushedSha === '' ? `refs/remotes/${REMOTE}/main` : remoteRef;
  const unpushed = (await git(root, 'rev-list', `-n${String(LIMIT)}`, 'HEAD', '--not', since).catch(() => '')).split('\n').filter(Boolean);
  if (pushedSha === '') {
    const { pr, error: prError } = await pullRequest;
    return { branch, blocked: null, pushed: null, unpushed, uncommitted: files.length, url: null, build: null, pr, prError };
  }

  const [{ pr, error: prError }, { run, error }] = await Promise.all([pullRequest, builds.read(root, pushedSha)]);
  let build: Build;
  if (error !== null) build = { state: 'unknown', logUrl: null, deploymentUrl: null, aliasUrl: null, at: null, error };
  else build = buildOf(run, run === null ? await pushedAt(root, remoteRef, pushedSha) : 0, builds.now());
  const url = build.aliasUrl ?? (pagesProject === null ? null : previewUrlOf(branch, pagesProject));
  return { branch, blocked: null, pushed: { sha: pushedSha }, unpushed, uncommitted: files.length, url, build, pr, prError };
}

// Pushes HEAD, as `before` read it, to the change request's branch on
// origin, never to main and never forced; Cloudflare Pages then builds it.
// A pull request open on the branch takes the commits too.
export async function pushHead(root: string, before: Preview, options: PreviewOptions) {
  const branch = before.branch ?? '';
  const head = before.unpushed[0];
  try {
    await run('git', ['push', '--quiet', REMOTE, `${head}:refs/heads/${branch}`], root, { timeoutMs: PUSH_TIMEOUT_MS });
  } catch (error) {
    const message = (error as Error).message;
    if (/\[rejected\]|non-fast-forward|fetch first/.test(message)) {
      throw new HttpError(409, `The remote has commits this change request does not: ${message}`);
    }
    if (error instanceof CommandError && error.killed) throw new HttpError(504, `The push to ${REMOTE} did not finish in time.`);
    throw new HttpError(502, `Could not push to ${REMOTE}: ${message}`);
  }
  // git moves origin/<branch> after a push only when the clone's fetch
  // refspec maps the branch (a --single-branch clone does not): move it here,
  // with the reflog entry pushedAt reads, so the branch reads as pushed.
  await git(root, 'update-ref', '-m', 'push', `refs/remotes/${REMOTE}/${branch}`, head);
  options.builds.pushed(head);
  options.pullRequests.forget(branch);
}

// Preview and Update PR: pushes the change request's commits. Opening a
// pull request is Publish (publish.ts). Answers the preview after the push.
export async function pushPreview(root: string, options: PreviewOptions): Promise<Preview> {
  const before = await loadPreview(root, options);
  if (before.blocked !== null || before.branch === null) throw new HttpError(409, before.blocked ?? 'nothing to preview');
  if (before.unpushed.length === 0) {
    throw new HttpError(409, before.pushed === null ? 'Nothing to push: commit a change first.' : 'Everything committed is pushed.');
  }
  await pushHead(root, before, options);
  return loadPreview(root, options);
}
