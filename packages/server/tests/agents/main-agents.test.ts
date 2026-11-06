import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Conversation, ConversationEvent } from '@fdbook/shared/agents.ts';
import type { ChangeRequest } from '#cr/manager.ts';
import { git } from '#git/command.ts';
import { onMainInfo } from '@fdbook/shared/agents.ts';
import { fakeProfile, messagesOf } from '#tests/support/agents.ts';
import { sender } from '#tests/support/auth.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json } from '#tests/support/http.ts';

type Read = { conversation: Conversation; events: ConversationEvent[] };

const NOTE = 'content/docs/index.mdx';

// Agents on main: any role, fenced to reading, in a copy of main, and
// create_cr hands the work to a new change request (#167).
describe('agents on main', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let mainRoot: string;
  let copy: string;
  const send = (path: string, method = 'GET', body?: unknown) => sender(studio.origin)(path, { method, body });

  const read = async (base: string, id: string) => json(await send(`${base}/api/agents/conversations/${id}`)) as Read;
  const settled = async (base: string, id: string) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const now = await read(base, id);
      if (now.conversation.status !== 'running') return now;
      if (Date.now() > deadline) throw new Error(`conversation ${id} did not end`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const start = async (role: string, prompt: string) => {
    const response = await send('/api/agents/conversations', 'POST', { agent: 'claude', role, prompt });
    expect(response.status).toBe(200);
    return (json(response) as { conversation: Conversation }).conversation;
  };
  const say = async (id: string, prompt: string) => {
    const response = await send(`/api/agents/conversations/${id}/messages`, 'POST', { prompt });
    expect(response.status).toBe(200);
    return settled('', id);
  };

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile(), fakeProfile({}, 'omp', false)] });
    const worktrees = await realpath(join(repo.home, 'worktrees'));
    mainRoot = join(worktrees, '_main');
    copy = join(worktrees, '_main-agents');
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('chats with an author on main in a copy of it, refusing every write, and leaves main and its branches as they were', async () => {
    const before = await readFile(join(mainRoot, NOTE), 'utf8');
    const head = (await git(mainRoot, 'rev-parse', 'HEAD')).trim();
    const started = await start('author', `env\nread ${join(copy, NOTE)}\nwrite ${join(copy, NOTE)} Written.\nask-edit\nask\nsneak ${join(copy, NOTE)} Sneaked.\nmcp propose_edit {"path":"${NOTE}","content":"x"}\nmcp read_note {"path":"${NOTE}"}`);
    const { conversation, events } = await settled('', started.id);
    expect(conversation).toMatchObject({ role: 'author', status: 'done', writes: [] });
    // Its messages in a row are held as one text.
    const said = messagesOf(events).join('');
    expect(said).toContain(`cwd:${copy}read:${before}refused:`);
    expect(said).toContain('reviewer reads only');
    // An edit and a command alike: the Studio says no without asking anyone.
    expect(said).toContain('answer:cancelledanswer:cancelled');
    expect(said).toMatch(/mcp-error:[^\n]*main is read only: call create_cr/);
    expect(said).toMatch(/mcp:[^]*Welcome\./);
    expect(events.filter((event) => event.type === 'answer').every((event) => event.by === 'studio')).toBe(true);
    // What the agent's own tool wrote stayed in its copy.
    expect(await readFile(join(copy, NOTE), 'utf8')).toBe('Sneaked.');
    expect(await readFile(join(mainRoot, NOTE), 'utf8')).toBe(before);
    expect(await git(mainRoot, 'status', '--porcelain')).toBe('');
    expect((await git(mainRoot, 'rev-parse', 'HEAD')).trim()).toBe(head);
    // Nothing to keep or revert.
    expect((await send(`/api/agents/conversations/${started.id}/turns/1/changes`)).status).toBe(409);
    expect((await send(`/api/agents/conversations/${started.id}/turns/1/changes`, 'POST', { path: NOTE, op: 'revert' })).status).toBe(403);
    // The next turn finds the copy as main is.
    const next = await say(started.id, `read ${join(copy, NOTE)}`);
    expect(messagesOf(next.events).join('').endsWith(`read:${before}`)).toBe(true);
  });

  it('runs only an agent whose own tools can be held to reading, in a change request the others still', async () => {
    const response = await send('/api/agents/conversations', 'POST', { agent: 'omp', role: 'reviewer', prompt: 'env' });
    expect(response.status).toBe(409);
    expect((json(response) as { error: string }).error).toBe('Fake Agent cannot be held to reading: chat with it in a change request');
    const info = { name: 'omp', version: '1', note: null };
    expect(onMainInfo([
      { ...info, id: 'claude', fencesReviewer: true, available: true, reason: null },
      { ...info, id: 'omp', fencesReviewer: false, available: true, reason: null },
      { ...info, id: 'hermes', fencesReviewer: false, available: false, reason: 'hermes is not installed' },
    ]).map((agent) => [agent.id, agent.available, agent.reason])).toEqual([
      ['claude', true, null],
      ['omp', false, 'omp cannot be held to reading: chat with it in a change request'],
      ['hermes', false, 'hermes is not installed'],
    ]);
  });

  it('commits nothing anyone keeps, and follows main: a commit in the copy is on no branch and goes with the next turn', async () => {
    const started = await start('reviewer', 'env');
    await settled('', started.id);
    await git(copy, 'commit', '--quiet', '--allow-empty', '-m', 'an agent commits');
    // Main moves on: a new change request fetches it.
    await repo.pushToMain({ 'content/docs/index.mdx': '---\ntitle: Home\n---\n\nWelcome back.\n' });
    expect((await send('/api/crs', 'POST', { name: 'Moves main' })).status).toBe(200);
    const branches = await git(repo.repo, 'for-each-ref', '--format=%(refname) %(objectname)');
    await say(started.id, 'env');
    expect(await readFile(join(copy, NOTE), 'utf8')).toContain('Welcome back.');
    expect((await git(copy, 'rev-parse', 'HEAD')).trim()).toBe((await git(mainRoot, 'rev-parse', 'HEAD')).trim());
    expect(await git(repo.repo, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(branches);
  });

  it('makes the copy fresh only while no turn on main uses it', async () => {
    const scratch = join(copy, 'scratch.txt');
    const go = join(repo.base, 'go-on');
    const busy = await start('author', `sneak ${scratch} Kept.\nwait ${go}`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await readFile(scratch, 'utf8').then(() => true, () => false))) await new Promise((resolve) => setTimeout(resolve, 20));
    // Another chat starts while the first one still answers: its file stays.
    const other = await start('reviewer', 'env');
    await settled('', other.id);
    expect(await readFile(scratch, 'utf8')).toBe('Kept.');
    await writeFile(go, '');
    await settled('', busy.id);
    // With no turn going on, the next one finds it gone.
    await say(other.id, 'env');
    await expect(readFile(scratch, 'utf8')).rejects.toThrow();
  });

  it('hands the work to a new change request through create_cr: once per message, with an author chat there', async () => {
    const started = await start('author', 'mcp create_cr {"name":"Tighten the home page","brief":"env"}\nmcp create_cr {"name":"Again","brief":"env"}');
    const { events } = await settled('', started.id);
    const said = messagesOf(events).join('');
    const result = JSON.parse(/^mcp:(\{[^]*?\n\})/.exec(said)?.[1] ?? '') as { slug: string; name: string; branch: string; url: string; conversationId: string };
    expect(result).toMatchObject({ slug: 'tighten-the-home-page', name: 'Tighten the home page', branch: 'cr/tighten-the-home-page' });
    expect(result.url).toBe(`http://127.0.0.1:${studio.port}/?cr=tighten-the-home-page&chat=${result.conversationId}`);
    expect(said).toMatch(/mcp-error:.*one per message/);
    expect(events.find((event) => event.type === 'handoff')).toMatchObject({ slug: result.slug, chat: result.conversationId, url: result.url });
    const { crs } = json(await send('/api/crs')) as { crs: ChangeRequest[] };
    expect(crs.map((cr) => cr.slug)).toContain('tighten-the-home-page');
    expect(crs.map((cr) => cr.slug)).not.toContain('again');
    // The author chat there: same agent, the brief as its message, from this chat.
    const there = await settled(`/cr/${result.slug}`, result.conversationId);
    expect(there.conversation).toMatchObject({ agent: 'claude', role: 'author', prompt: 'env' });
    expect(there.events.find((event) => event.type === 'turn')).toMatchObject({ prompt: 'env', from: started.id });
    expect(messagesOf(there.events).join('')).toContain(`cwd:${join(await realpath(join(repo.home, 'worktrees')), result.slug)}`);
  });

  it('keeps change requests as they were: their agents get no create_cr', async () => {
    const cr = (json(await send('/api/crs', 'POST', { name: 'Plain' })) as { cr: ChangeRequest }).cr;
    const response = await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent: 'claude', role: 'author', prompt: 'mcp create_cr {"name":"Nested","brief":"env"}' });
    const { conversation } = json(response) as { conversation: Conversation };
    const { events } = await settled(`/cr/${cr.slug}`, conversation.id);
    expect(messagesOf(events).join('')).toMatch(/^mcp-error:.*for a person's agent/);
  });
});
