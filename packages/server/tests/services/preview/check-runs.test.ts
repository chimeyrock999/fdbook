import { describe, expect, it, vi } from 'vitest';
import { buildOf, createBuildReader, githubRepoOf, parseSummary, type CheckRun } from '#services/preview/check-runs.ts';

// The summary Cloudflare Pages wrote on da3bede (the #7 probe), as gh returns it.
const SUMMARY =
  "<table><tr><td><strong>Latest commit:</strong> </td><td>\n<code>da3bede</code>\n</td></tr>\n<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>\n<tr><td><strong>Preview URL:</strong></td><td>\n<a href='https://4bf6f301.chimeyrock.pages.dev'>https://4bf6f301.chimeyrock.pages.dev</a>\n</td></tr>\n<tr><td><strong>Branch Preview URL:</strong></td><td>\n<a href='https://cr-test.chimeyrock.pages.dev'>https://cr-test.chimeyrock.pages.dev</a>\n</td></tr>\n</table>\n\n[View logs](https://dash.cloudflare.com/?to=/92c2436fd1880284ada93f969ffd7bab/pages/view/chimeyrock/4bf6f301-c819-4004-ad97-3bb8e1b973d6)\n";
const LOG = 'https://dash.cloudflare.com/?to=/92c2436fd1880284ada93f969ffd7bab/pages/view/chimeyrock/4bf6f301-c819-4004-ad97-3bb8e1b973d6';

const run = (fields: Partial<CheckRun>): CheckRun => ({
  status: 'completed',
  conclusion: 'success',
  detailsUrl: LOG,
  summary: SUMMARY,
  startedAt: '2026-10-20T09:21:20Z',
  completedAt: '2026-10-20T09:22:51Z',
  ...fields,
});

describe('parseSummary', () => {
  it('reads the deployment and branch URLs Cloudflare writes', () => {
    expect(parseSummary(SUMMARY)).toEqual({ deploymentUrl: 'https://4bf6f301.chimeyrock.pages.dev', aliasUrl: 'https://cr-test.chimeyrock.pages.dev' });
  });

  it('reads nothing from a summary still building or of another shape', () => {
    expect(parseSummary('<table><tr><td><strong>Status:</strong></td><td>⚡️ Building…</td></tr></table>')).toEqual({ deploymentUrl: null, aliasUrl: null });
    expect(parseSummary(null)).toEqual({ deploymentUrl: null, aliasUrl: null });
    // Only Pages URLs: a link elsewhere is not the preview.
    expect(parseSummary("<strong>Preview URL:</strong> <a href='https://evil.example'>x</a>")).toEqual({ deploymentUrl: null, aliasUrl: null });
  });
});

describe('githubRepoOf', () => {
  it.each([
    ['git@github.com:chimeyrock999/chimeyrock.git', 'chimeyrock999/chimeyrock'],
    ['https://github.com/chimeyrock999/chimeyrock.git', 'chimeyrock999/chimeyrock'],
    ['https://github.com/chimeyrock999/chimeyrock', 'chimeyrock999/chimeyrock'],
    ['ssh://git@github.com/chimeyrock999/notes.site.git\n', 'chimeyrock999/notes.site'],
    ['/tmp/origin.git', null],
    ['https://gitlab.com/a/b.git', null],
  ])('reads %s as %s', (url, repo) => {
    expect(githubRepoOf(url)).toBe(repo);
  });
});

describe('buildOf', () => {
  const pushedMs = Date.parse('2026-10-20T09:21:00Z');

  it('is ready on success, with the log and both URLs', () => {
    expect(buildOf(run({}), pushedMs, pushedMs)).toEqual({
      state: 'ready',
      logUrl: LOG,
      deploymentUrl: 'https://4bf6f301.chimeyrock.pages.dev',
      aliasUrl: 'https://cr-test.chimeyrock.pages.dev',
      at: '2026-10-20T09:22:51Z',
      error: null,
    });
  });

  it.each([
    ['queued', null, 'building'],
    ['in_progress', null, 'building'],
    ['completed', 'failure', 'failed'],
    ['completed', 'cancelled', 'failed'],
    ['completed', 'timed_out', 'failed'],
    ['completed', 'action_required', 'failed'],
    ['completed', 'skipped', 'skipped'],
    ['completed', 'neutral', 'skipped'],
  ])('maps %s / %s to %s', (status, conclusion, state) => {
    expect(buildOf(run({ status, conclusion, summary: null }), pushedMs, pushedMs).state).toBe(state);
  });

  it('waits for a check run for three minutes after the push, then says no build came', () => {
    expect(buildOf(null, pushedMs, pushedMs + 179_000)).toMatchObject({ state: 'waiting', logUrl: null });
    expect(buildOf(null, pushedMs, pushedMs + 180_000)).toMatchObject({ state: 'none', logUrl: null });
  });
});

describe('createBuildReader', () => {
  it('reads a finished build every minute and an unfinished one at most every 10 seconds', async () => {
    let now = 0;
    const read = vi.fn((_root: string, sha: string) => Promise.resolve(sha === 'done' ? run({}) : run({ status: 'in_progress', conclusion: null })));
    const builds = createBuildReader(read, () => now);
    await builds.read('/repo', 'done');
    await builds.read('/repo', 'busy');
    now = 9_000;
    await builds.read('/repo', 'done');
    await builds.read('/repo', 'busy');
    expect(read).toHaveBeenCalledTimes(2);
    now = 11_000;
    await builds.read('/repo', 'done');
    await builds.read('/repo', 'busy');
    expect(read.mock.calls.map(([, sha]) => sha)).toEqual(['done', 'busy', 'busy']);
    // Cloudflare can retry a build on the same commit.
    now = 61_000;
    await builds.read('/repo', 'done');
    expect(read.mock.calls.map(([, sha]) => sha)).toEqual(['done', 'busy', 'busy', 'done']);
  });

  it('reads a commit again once it is pushed', async () => {
    const read = vi.fn(() => Promise.resolve(null));
    const builds = createBuildReader(read, () => 0);
    await builds.read('/repo', 'abc');
    builds.pushed('abc');
    await builds.read('/repo', 'abc');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers why gh failed instead of throwing, and asks again later', async () => {
    let now = 0;
    const read = vi.fn(() => Promise.reject(new Error('gh: not logged in')));
    const builds = createBuildReader(read, () => now);
    expect(await builds.read('/repo', 'abc')).toEqual({ run: null, error: 'gh: not logged in' });
    now = 11_000;
    await builds.read('/repo', 'abc');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
