import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '#infra/command.ts';
import { openChangeRequests } from '#services/cr/manager.ts';

// A site just made with create-fumadocs-app is a repository with one commit
// on main and no remote: the Studio says what to add instead of a git error.
const made: string[] = [];

async function newSite() {
  const base = await mkdtemp(join(tmpdir(), 'notes-studio-origin-'));
  made.push(base);
  const repo = join(base, 'site');
  await git(base, 'init', '--quiet', '--initial-branch=main', repo);
  for (const [key, value] of [['user.name', 'Studio Test'], ['user.email', 'studio@example.com'], ['commit.gpgsign', 'false']]) {
    await git(repo, 'config', key, value);
  }
  await writeFile(join(repo, 'README.md'), 'site\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '--quiet', '-m', 'Initial commit');
  return { base, repo, home: join(base, 'home') };
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((base) => rm(base, { recursive: true, force: true })));
});

describe('opening change requests without origin/main', () => {
  it('asks for a remote named origin when there is none', async () => {
    const { repo, home } = await newSite();
    await expect(openChangeRequests({ repo, home })).rejects.toThrow(/needs a git remote named origin with a main branch.*git remote add origin <url>.*git push -u origin main/);
  });

  it('asks to push main when origin has none yet', async () => {
    const { base, repo, home } = await newSite();
    await git(base, 'init', '--quiet', '--bare', '--initial-branch=main', join(base, 'origin.git'));
    await git(repo, 'remote', 'add', 'origin', join(base, 'origin.git'));
    await expect(openChangeRequests({ repo, home })).rejects.toThrow(/reads origin\/main, which does not exist yet: push main with `git push -u origin main`/);
  });
});
