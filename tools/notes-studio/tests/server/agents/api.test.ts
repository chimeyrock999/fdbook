import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent, RunSummary, StreamEvent } from '../../../server/agents/shared';
import type { ChangeRequest } from '../../../server/cr/manager';
import { fakeProfile } from '../../support/agents';
import { fakeAuth, sender, signInWith } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';

type Run = { run: RunSummary; events: RunEvent[] };

// Reads the agent event stream at `url` until `stop` holds (or 10 s pass).
async function collect(url: string, stop: (events: StreamEvent[]) => boolean, act: () => Promise<void>) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (!buffer.includes('\n\n')) buffer += (await reader.read()).value ?? '';
  buffer = '';
  await act();
  const events: StreamEvent[] = [];
  const deadline = Date.now() + 10_000;
  while (!stop(events) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const data = buffer.slice(0, end).split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
      buffer = buffer.slice(end + 2);
      if (data) events.push(JSON.parse(data) as StreamEvent);
    }
  }
  controller.abort();
  return events;
}

describe('agents API', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  let base: string;
  const send = (path: string, method = 'GET', body?: unknown) => sender(studio.origin)(path, { method, body });

  const waitEnded = async (id: string) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const run = json(await send(`${base}/api/agents/runs/${id}`)) as Run;
      if (run.run.status !== 'running' || Date.now() > deadline) return run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile()] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Agent edits' })) as { cr: ChangeRequest }).cr;
    base = `/cr/${cr.slug}`;
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('lists the agents and whether they can run', async () => {
    expect(json(await send('/api/agents'))).toEqual({ agents: [{ id: 'claude', name: 'Fake Agent', fencesReviewer: true, available: true, reason: null, note: null, version: '1.0.0' }] });
    expect(json(await send(`${base}/api/agents`))).toMatchObject({ agents: [{ id: 'claude' }] });
  });

  it('runs no agent on main', async () => {
    expect((await send('/api/agents/runs')).status).toBe(409);
    expect((await send('/api/agents/runs', 'POST', { agent: 'claude', role: 'author', prompt: 'env' })).status).toBe(403);
  });

  it('runs an agent in the change request\'s worktree, proposing an edit to a note there and streaming it', async () => {
    const note = join(cr.worktree ?? '', 'content/notes/guide/first-look.mdx');
    const before = await readFile(note, 'utf8');
    const added = join(cr.worktree ?? '', 'content/notes/guide/added.mdx');
    let started = null as RunSummary | null;
    const events = await collect(
      `${studio.origin}${base}/api/agents/events`,
      (seen) => seen.some((event) => event.type === 'end'),
      async () => {
        const response = await send(`${base}/api/agents/runs`, 'POST', { agent: 'claude', role: 'author', prompt: `write ${note} Agent wrote this.\nwrite ${added} A new note.\nwrite ${added} A new note, fixed.` });
        expect(response.status).toBe(200);
        started = (json(response) as { run: RunSummary }).run;
      },
    );
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['start', 'proposal', 'write', 'update', 'end']));
    expect(events.every((event) => event.runId === started?.id)).toBe(true);
    // A note that exists is proposed to, never written; a new one is
    // written, and so is the run's fix to the note it created.
    expect(await readFile(note, 'utf8')).toBe(before);
    expect(await readFile(added, 'utf8')).toBe('A new note, fixed.');
    const { proposals } = json(await send(`${base}/api/proposals`)) as { proposals: { path: string; by: unknown; hunks: { added: string }[] }[] };
    expect(proposals).toEqual([expect.objectContaining({ path: 'content/notes/guide/first-look.mdx', by: { kind: 'run', runId: started?.id, agent: 'claude', model: 'Fake One' } })]);
    expect(proposals[0]?.hunks.map((hunk) => hunk.added).join('')).toContain('Agent wrote this.');
    // The agent hears that its write became a proposal.
    const said = events.flatMap((event) => (event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk' && event.update.content.type === 'text' ? [event.update.content.text] : []));
    expect(said.join('\n')).toMatch(/refused:.*made this write a proposal .* content\/notes\/guide\/first-look\.mdx is unchanged/);

    const run = await waitEnded(started?.id ?? '');
    expect(run.run, JSON.stringify(run.events.slice(-4))).toMatchObject({ status: 'done', writes: ['content/notes/guide/added.mdx'], model: 'Fake One' });
    const list = json(await send(`${base}/api/agents/runs`)) as { runs: RunSummary[] };
    expect(list.runs.map((item) => item.id)).toContain(run.run.id);
    // The list of change requests reads each one's runs and cost.
    expect(json(await send('/api/agents/totals'))).toEqual({ totals: { [cr.slug]: { runs: 1, costs: { USD: 0.12 } } } });
  });

  it('answers a permission request and a cancel over HTTP', async () => {
    const started = (json(await send(`${base}/api/agents/runs`, 'POST', { agent: 'claude', role: 'author', prompt: 'ask\nhang' })) as { run: RunSummary }).run;
    let asked: Extract<RunEvent, { type: 'permission' }> | undefined;
    for (let tries = 0; asked === undefined && tries < 200; tries += 1) {
      const run = json(await send(`${base}/api/agents/runs/${started.id}`)) as Run;
      asked = run.events.find((event): event is Extract<RunEvent, { type: 'permission' }> => event.type === 'permission');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const path = `${base}/api/agents/runs/${started.id}/permissions/${asked?.ask.id ?? ''}`;
    expect((await send(path, 'POST', { optionId: 'nope' })).status).toBe(400);
    expect((await send(path, 'POST', { optionId: 'no' })).status).toBe(200);
    expect((await send(path, 'POST', { optionId: 'no' })).status).toBe(409);
    expect((await send(`${base}/api/agents/runs/${started.id}/cancel`, 'POST', {})).status).toBe(200);
    expect((await waitEnded(started.id)).run.status).toBe('cancelled');
    expect((await send(`${base}/api/agents/runs/${started.id}/cancel`, 'POST', {})).status).toBe(409);
  });

  it('answers 404 for a run that does not exist', async () => {
    expect((await send(`${base}/api/agents/runs/no-such-run`)).status).toBe(404);
  });

  it('stops the runs and drops the transcripts of a discarded change request', async () => {
    const other = (json(await send('/api/crs', 'POST', { name: 'Thrown away' })) as { cr: ChangeRequest }).cr;
    const started = (json(await send(`/cr/${other.slug}/api/agents/runs`, 'POST', { agent: 'claude', role: 'author', prompt: 'deaf' })) as { run: RunSummary }).run;
    const transcript = join(repo.home, 'agents', other.slug, `${started.id}.jsonl`);
    for (let tries = 0; !existsSync(transcript) && tries < 100; tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(transcript)).toBe(true);
    const discarded = await send(`/api/crs/${other.slug}/discard`, 'POST', { dryRun: false });
    expect(discarded.status).toBe(200);
    expect(existsSync(join(repo.home, 'agents', other.slug))).toBe(false);
  });
});

describe('agents API with sign-in', () => {
  let repo: GitRepo;
  let studio: CrStudio;

  beforeAll(async () => {
    repo = await makeGitRepo();
    const faked = fakeAuth(repo.home);
    faked.gh.addUser('admin', 'admin');
    faked.gh.addUser('writer', 'write');
    faked.gh.addUser('reader', 'read');
    studio = await startCrStudio(repo, { auth: faked.auth, agents: [fakeProfile()] });
    Object.assign(studio, { gh: faked.gh });
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('lets readers and writers follow runs, and only an admin start and answer them, recording who did', async () => {
    const send = sender(studio.origin);
    const gh = (studio as unknown as { gh: Parameters<typeof signInWith>[1] }).gh;
    const admin = await signInWith(send, gh, 'admin');
    const writer = await signInWith(send, gh, 'writer');
    const reader = await signInWith(send, gh, 'reader');
    const created = await send('/api/crs', { method: 'POST', body: { name: 'Signed' }, ...writer });
    const slug = (json(created) as { cr: ChangeRequest }).cr.slug;
    const runs = `/cr/${slug}/api/agents/runs`;
    const body = { agent: 'claude', role: 'author', prompt: 'env' };

    expect((await send(runs)).status).toBe(401);
    expect((await send(runs, { method: 'POST', body, ...reader })).status).toBe(403);
    // A run is commands as the host's user: a writer may not start one.
    expect((await send(runs, { method: 'POST', body, ...writer })).status).toBe(403);
    expect((await send(runs, reader)).status).toBe(200);
    expect((await send(runs, writer)).status).toBe(200);
    const started = await send(runs, { method: 'POST', body, ...admin });
    expect(started.status).toBe(200);
    const run = (json(started) as { run: RunSummary }).run;
    expect(run.by).toBe('admin');
    expect((await send(`${runs}/${run.id}/cancel`, { method: 'POST', body: {}, ...writer })).status).toBe(403);
    expect((await send(`/cr/${slug}/api/agents/events`, { headers: { Range: 'x' } })).status).toBe(401);
  });
});
