import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '../../server/cr/git';
import type { PullRequest } from '../../server/cr/pull-requests';
import { createBuildReader, type CheckRun } from '../../server/preview/check-runs';
import { startStudioServer } from '../../server/studio-server';

const NOTES: Record<string, string> = {
  'content/notes/index.mdx': '---\ntitle: Home\n---\n\nWelcome.\n',
  'content/notes/meta.yaml': 'pages:\n  - index\n  - guide\n',
  'content/notes/guide/index.mdx': '---\ntitle: Guide\n---\n\nThe guide.\n',
  'content/notes/guide/meta.yaml': 'title: Guide\npages:\n  - first-look\n',
  'content/notes/guide/first-look.mdx': '---\ntitle: First look\n---\n\nA first look.\n',
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
// report, or to an Error to fail. `closed` lists the pull requests closed,
// `closeError` fails closing one. `forget` moves the build reader's clock a
// minute on, past its cache.
export async function startCrStudio(repo: GitRepo, { pagesProject = 'chimey', staleDays }: { pagesProject?: string | null; staleDays?: number } = {}) {
  let clock = Date.now();
  const fake: { prs: PullRequest[] | Error; checks: Map<string, CheckRun> | Error; closed: number[]; closeError: Error | null; forget: () => void } = {
    prs: [],
    checks: new Map(),
    closed: [],
    closeError: null,
    forget: () => { clock += 60_000; },
  };
  const builds = createBuildReader(
    (_root, sha) => (fake.checks instanceof Error ? Promise.reject(fake.checks) : Promise.resolve(fake.checks.get(sha) ?? null)),
    () => clock,
  );
  const studio = await startStudioServer({
    port: 0,
    changeRequests: {
      repo: repo.repo,
      home: repo.home,
      pagesProject,
      builds,
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
