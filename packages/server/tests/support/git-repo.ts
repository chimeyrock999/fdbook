import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '#infra/command.ts';
import type { PullRequest } from '#services/cr/pull-requests.ts';
import { createBuildReader, type CheckRun } from '#services/preview/check-runs.ts';
import { createBranchPullRequestReader, type BranchPullRequest, type NewPullRequest, type PullRequestGh } from '#services/preview/pull-request.ts';
import type { AgentProfile } from '#services/agents/acp/profiles.ts';
import type { AuthOptions } from '#services/auth/auth.ts';
import type { StudioTool } from '#routes/mcp/tool.ts';
import { startStudioServer } from '#app/studio-server.ts';

const NOTES: Record<string, string> = {
  'content/docs/index.mdx': '---\ntitle: Home\n---\n\nWelcome.\n',
  'content/docs/meta.yaml': 'pages:\n  - index\n  - guide\n',
  'content/docs/guide/index.mdx': '---\ntitle: Guide\n---\n\nThe guide.\n',
  'content/docs/guide/meta.yaml': 'title: Guide\npages:\n  - first-look\n',
  'content/docs/guide/first-look.mdx': '---\ntitle: First look\n---\n\nA first look.\n',
  'package.json': '{}\n',
};

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

// A throwaway git setup: a bare `origin` with a few notes on main, the clone
// the Studio branches from (`repo`), another clone that stands in for
// someone pushing to main, and an empty Studio home.
export async function makeGitRepo() {
  const base = await mkdtemp(join(tmpdir(), 'notes-studio-cr-'));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  const other = join(base, 'other');
  const home = join(base, 'home');
  await git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  for (const clone of [repo, other]) {
    await git(base, 'clone', '--quiet', origin, clone);
    await git(clone, 'config', 'user.name', 'Studio Test');
    await git(clone, 'config', 'user.email', 'studio@example.com');
    await git(clone, 'config', 'commit.gpgsign', 'false');
  }
  await writeFiles(other, NOTES);
  await git(other, 'add', '-A');
  await git(other, 'commit', '--quiet', '-m', 'notes');
  await git(other, 'push', '--quiet', 'origin', 'HEAD:main');
  await git(repo, 'fetch', '--quiet', 'origin');
  await git(repo, 'checkout', '--quiet', '-b', 'main', 'origin/main');

  return {
    base,
    origin,
    repo,
    home,
    // Commits `files` on main from the other clone and pushes them; the repo has not fetched them.
    async pushToMain(files: Record<string, string>, message = 'update') {
      await git(other, 'pull', '--quiet', 'origin', 'main');
      await writeFiles(other, files);
      await git(other, 'add', '-A');
      await git(other, 'commit', '--quiet', '-m', message);
      await git(other, 'push', '--quiet', 'origin', 'HEAD:main');
      return (await git(other, 'rev-parse', 'HEAD')).trim();
    },
    remove: () => rm(base, { recursive: true, force: true }),
  };
}

export type GitRepo = Awaited<ReturnType<typeof makeGitRepo>>;

// A Studio with change requests over a throwaway repo. `prs` and `checks`
// stand in for gh: set them to the pull requests or check runs (by commit) to
// report, or to an Error to fail. `branchPrs` is what `gh pr list --head`
// reads by branch (or an Error); `create` opens one there and lists it in
// `created`, unless `createError` is set. `closed` lists the pull requests
// closed, `closeError` fails closing one. `forget` moves the readers' clock
// a minute on, past their caches. `auth` turns sign-in on (support/auth.ts).
// `agents` stands in for the Studio's agent profiles (support/agents.ts).
export async function startCrStudio(
  repo: GitRepo,
  { pagesProject = 'chimey', staleDays, auth = null, agents = [], tools = [] }: { pagesProject?: string | null; staleDays?: number; auth?: AuthOptions | null; agents?: AgentProfile[]; tools?: StudioTool[] } = {},
) {
  let clock = Date.now();
  const fake: {
    prs: PullRequest[] | Error;
    checks: Map<string, CheckRun> | Error;
    branchPrs: Map<string, BranchPullRequest> | Error;
    created: NewPullRequest[];
    createError: Error | null;
    closed: number[];
    closeError: Error | null;
    forget: () => void;
  } = {
    prs: [],
    checks: new Map(),
    branchPrs: new Map(),
    created: [],
    createError: null,
    closed: [],
    closeError: null,
    forget: () => { clock += 60_000; },
  };
  const pullRequestGh: PullRequestGh = {
    view: (_root, branch) => (fake.branchPrs instanceof Error ? Promise.reject(fake.branchPrs) : Promise.resolve(fake.branchPrs.get(branch) ?? null)),
    create: (_root, request) => {
      if (fake.createError !== null) return Promise.reject(fake.createError);
      if (fake.branchPrs instanceof Error) return Promise.reject(fake.branchPrs);
      fake.created.push(request);
      const number = 100 + fake.created.length;
      fake.branchPrs.set(request.branch, { number, url: `https://github.com/o/r/pull/${String(number)}`, state: 'OPEN', title: request.title });
      return Promise.resolve();
    },
  };
  const builds = createBuildReader(
    (_root, sha) => (fake.checks instanceof Error ? Promise.reject(fake.checks) : Promise.resolve(fake.checks.get(sha) ?? null)),
    () => clock,
  );
  const studio = await startStudioServer({
    port: 0,
    auth,
    agents,
    tools,
    changeRequests: {
      repo: repo.repo,
      home: repo.home,
      pagesProject,
      builds,
      branchPullRequests: createBranchPullRequestReader(pullRequestGh, () => clock),
      pullRequests: () => (fake.prs instanceof Error ? Promise.reject(fake.prs) : Promise.resolve(fake.prs)),
      closePullRequest: (number) => {
        if (fake.closeError !== null) return Promise.reject(fake.closeError);
        fake.closed.push(number);
        return Promise.resolve();
      },
      staleDays,
    },
  });
  const port = String((studio.server.address() as AddressInfo).port);
  return { ...studio, fake, port, origin: `http://127.0.0.1:${port}` };
}

export type CrStudio = Awaited<ReturnType<typeof startCrStudio>>;
