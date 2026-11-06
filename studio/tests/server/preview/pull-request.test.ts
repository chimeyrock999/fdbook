import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { git } from '../../../server/cr/git';
import { createBranchPullRequestReader, ghPullRequest, type BranchPullRequest, type PullRequestGh } from '../../../server/preview/pull-request';

const OPEN: BranchPullRequest = { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Probe' };

const ghOf = (view: PullRequestGh['view']): PullRequestGh => ({ view, create: () => Promise.resolve() });

describe('createBranchPullRequestReader', () => {
  it('reads a branch once while fresh, and again once forgotten', async () => {
    let clock = 0;
    const view = vi.fn(() => Promise.resolve(OPEN));
    const reader = createBranchPullRequestReader(ghOf(view), () => clock);
    expect(await reader.read('/r', 'cr/a')).toEqual({ pr: OPEN, error: null });
    clock += 10_000;
    await reader.read('/r', 'cr/a');
    expect(view).toHaveBeenCalledTimes(1);
    reader.forget('cr/a');
    await reader.read('/r', 'cr/a');
    expect(view).toHaveBeenCalledTimes(2);
    await reader.read('/r', 'cr/a', true);
    expect(view).toHaveBeenCalledTimes(3);
  });

  it('reads an open pull request again sooner than a merged one', async () => {
    let clock = 0;
    let state: BranchPullRequest['state'] = 'OPEN';
    const view = vi.fn(() => Promise.resolve({ ...OPEN, state }));
    const reader = createBranchPullRequestReader(ghOf(view), () => clock);
    await reader.read('/r', 'cr/a');
    clock += 15_000;
    state = 'MERGED';
    expect((await reader.read('/r', 'cr/a')).pr?.state).toBe('MERGED');
    clock += 30_000;
    await reader.read('/r', 'cr/a');
    expect(view).toHaveBeenCalledTimes(2);
    clock += 30_000;
    await reader.read('/r', 'cr/a');
    expect(view).toHaveBeenCalledTimes(3);
  });

  it('answers why gh failed instead of throwing', async () => {
    const reader = createBranchPullRequestReader(ghOf(() => Promise.reject(new Error('gh: not logged in'))));
    expect(await reader.read('/r', 'cr/a')).toEqual({ pr: null, error: 'gh: not logged in' });
  });
});

// The real gh calls, against a stand-in `gh` on PATH that logs its
// arguments and answers what the test wrote.
describe('ghPullRequest', () => {
  let dir: string;
  let repo: string;
  let path: string | undefined;
  const answer = (stdout: string, code = 0, stderr = '') =>
    writeFile(join(dir, 'answer.sh'), `printf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${String(code)}\n`);
  // One record (\x1e) per call, each argument ended by a NUL.
  const calls = async () => (await readFile(join(dir, 'calls.log'), 'utf8')).split('\x1e').filter(Boolean).map((call) => call.split('\0').slice(0, -1));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'notes-studio-gh-'));
    repo = join(dir, 'repo');
    await git(dir, 'init', '--quiet', repo);
    await git(repo, 'remote', 'add', 'origin', 'git@github.com:chimeyrock999/chimeyrock.git');
    const gh = join(dir, 'gh');
    await writeFile(gh, `#!/bin/sh\n{ for arg in "$@"; do printf '%s\\0' "$arg"; done; printf '\\036'; } >> "${join(dir, 'calls.log')}"\n. "${join(dir, 'answer.sh')}"\n`);
    await chmod(gh, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${path ?? ''}`;
  });

  afterAll(async () => {
    process.env.PATH = path;
    await rm(dir, { recursive: true, force: true });
  });

  const listed = (number: number, fields: Partial<BranchPullRequest & { isCrossRepository: boolean }> = {}) =>
    ({ ...OPEN, number, url: `https://github.com/o/r/pull/${String(number)}`, isCrossRepository: false, ...fields });

  it("lists the branch's pull requests on origin's repository, the newest of its own winning", async () => {
    await answer(JSON.stringify([listed(5, { state: 'MERGED' }), listed(9, { state: 'CLOSED' }), listed(12, { isCrossRepository: true })]));
    expect(await ghPullRequest.view(repo, 'cr/a')).toEqual({ number: 9, url: 'https://github.com/o/r/pull/9', state: 'CLOSED', title: 'Probe' });
    expect((await calls()).at(-1)).toEqual([
      'pr', 'list', '--repo', 'chimeyrock999/chimeyrock', '--head', 'cr/a', '--state', 'all', '--limit', '50', '--json', 'number,url,state,title,isCrossRepository',
    ]);
  });

  it('reads none, or only a fork’s of the same branch name, as no pull request', async () => {
    await answer('[]');
    expect(await ghPullRequest.view(repo, 'cr/a')).toBeNull();
    await answer(JSON.stringify([listed(12, { isCrossRepository: true })]));
    expect(await ghPullRequest.view(repo, 'cr/a')).toBeNull();
  });

  it('throws what gh says when it fails', async () => {
    await answer('', 4, 'To get started with GitHub CLI, please run:  gh auth login');
    await expect(ghPullRequest.view(repo, 'cr/a')).rejects.toThrow(/gh auth login/);
  });

  it('opens a pull request from the branch to main, title and body as given', async () => {
    await answer('https://github.com/chimeyrock999/chimeyrock/pull/9\n');
    await ghPullRequest.create(repo, { branch: 'cr/a', title: 'Probe', body: '- one\n- `two` $(no shell)' });
    expect((await calls()).at(-1)).toEqual([
      'pr', 'create', '--repo', 'chimeyrock999/chimeyrock', '--base', 'main', '--head', 'cr/a', '--title', 'Probe', '--body', '- one\n- `two` $(no shell)',
    ]);
  });
});
