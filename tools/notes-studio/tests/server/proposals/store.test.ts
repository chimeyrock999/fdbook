import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpError } from '../../../server/http';
import { applyEdits, createProposals, type Proposals } from '../../../server/proposals/store';
import type { ProposalView } from '../../../server/proposals/shared';

const PATH = 'content/notes/guide.mdx';
const NOTE = '---\ntitle: Guide\n---\n\n# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';
const BY = { kind: 'run', runId: 'r1', agent: 'claude', model: 'fake-1' } as const;

describe('proposals', () => {
  let base: string;
  let root: string;
  let proposals: Proposals;
  let changes: ProposalView[];
  const disk = () => readFile(join(root, PATH), 'utf8');
  const status = async (promise: Promise<unknown>) => promise.then(() => 200, (error: unknown) => (error as HttpError).status);

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'notes-studio-proposals-'));
    root = join(base, 'worktree');
    await mkdir(join(root, 'content/notes'), { recursive: true });
    await writeFile(join(root, PATH), NOTE);
    await writeFile(join(root, 'content/notes/meta.yaml'), 'pages:\n  - guide\n');
    changes = [];
    proposals = createProposals(root, { dir: join(base, 'proposals', 'cr'), onChange: (view) => changes.push(view) });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('stores a proposal as hunks and leaves the note alone', async () => {
    const before = await stat(join(root, PATH));
    const next = NOTE.replace('First paragraph.', 'First, rewritten.').replace('Third paragraph.', 'Third, rewritten.');
    const view = await proposals.propose({ path: PATH, content: next, by: BY, summary: 'Tighten' });
    expect(view).toMatchObject({ path: PATH, by: BY, summary: 'Tighten', stale: false, done: false });
    expect(view.hunks.map((hunk) => [hunk.id, hunk.state])).toEqual([['1', 'open'], ['2', 'open']]);
    expect(await disk()).toBe(NOTE);
    expect((await stat(join(root, PATH))).mtimeMs).toBe(before.mtimeMs);
    expect(view.text).toBe(next);
    expect(await proposals.list(PATH)).toEqual([{ ...changes[0] }]);
    expect(changes[0]).toMatchObject({ id: view.id, hunks: view.hunks });
    expect(changes).toHaveLength(1);
  });

  it('takes find/replace edits on the note as it is', async () => {
    const view = await proposals.propose({ path: PATH, edits: [{ find: 'Second paragraph.', replace: 'Second, edited.' }], by: BY });
    expect(view.hunks).toHaveLength(1);
    expect(view.hunks[0]?.added).toContain('Second, edited.');
    expect(() => applyEdits(NOTE, [{ find: 'paragraph.', replace: 'x' }])).toThrow(/more than once/);
    expect(() => applyEdits(NOTE, [{ find: 'Nowhere', replace: 'x' }])).toThrow(/not in the note/);
  });

  it('refuses what is not a change to an existing note that parses', async () => {
    expect(await status(proposals.propose({ path: 'content/notes/meta.yaml', content: 'x', by: BY }))).toBe(403);
    expect(await status(proposals.propose({ path: '../outside.mdx', content: 'x', by: BY }))).toBe(403);
    expect(await status(proposals.propose({ path: 'content/notes/missing.mdx', content: 'x', by: BY }))).toBe(404);
    expect(await status(proposals.propose({ path: PATH, content: NOTE, by: BY }))).toBe(409);
    expect(await status(proposals.propose({ path: PATH, content: `${NOTE}\n<Broken\n`, by: BY }))).toBe(422);
    expect(await status(proposals.propose({ path: PATH, by: BY }))).toBe(400);
  });

  it('accepts one hunk at a time, then the rest, giving exactly the proposed note', async () => {
    const next = NOTE.replace('First paragraph.', 'First, rewritten.').replace('Third paragraph.', 'Third, rewritten.');
    const { id } = await proposals.propose({ path: PATH, content: next, by: BY });
    const once = await proposals.act(id, 'accept', ['2']);
    expect(await disk()).toBe(NOTE.replace('Third paragraph.', 'Third, rewritten.'));
    expect(once.hunks.map((hunk) => hunk.state)).toEqual(['open', 'accepted']);
    const all = await proposals.act(id, 'accept');
    expect(await disk()).toBe(next);
    expect(all.done).toBe(true);
    expect(await status(proposals.act(id, 'accept'))).toBe(409);
  });

  it('rejects without writing', async () => {
    const { id } = await proposals.propose({ path: PATH, content: NOTE.replace('First paragraph.', 'Nope.'), by: BY });
    expect((await proposals.act(id, 'reject')).hunks[0]?.state).toBe('rejected');
    expect(await disk()).toBe(NOTE);
  });

  it('keeps a hunk open when a person edits elsewhere, and stale when they edit its block', async () => {
    const { id } = await proposals.propose({ path: PATH, content: NOTE.replace('Second paragraph.', 'Second, by the agent.'), by: BY });
    await writeFile(join(root, PATH), NOTE.replace('Third paragraph.', 'Third, by a person.'));
    expect((await proposals.read(id)).hunks[0]?.state).toBe('open');
    await proposals.act(id, 'accept');
    expect(await disk()).toBe(NOTE.replace('Second paragraph.', 'Second, by the agent.').replace('Third paragraph.', 'Third, by a person.'));

    const other = await proposals.propose({ path: PATH, content: (await disk()).replace('# Guide', '# The guide'), by: BY });
    await writeFile(join(root, PATH), (await disk()).replace('# Guide', '# Guide, by a person'));
    const stale = await proposals.read(other.id);
    expect(stale.stale).toBe(true);
    expect(await status(proposals.act(other.id, 'accept'))).toBe(409);
    const moved = await proposals.act(other.id, 'rebase');
    expect(moved.hunks[0]?.state).toBe('open');
    expect(moved.hunks[0]?.removed).toContain('# Guide, by a person');
    await proposals.act(other.id, 'accept');
    expect(await disk()).toContain('# The guide\n');
  });

  it('drops a stale hunk whose anchors are gone', async () => {
    const { id } = await proposals.propose({ path: PATH, content: NOTE.replace('Second paragraph.', 'Second, by the agent.'), by: BY });
    await writeFile(join(root, PATH), NOTE.replace('First paragraph.', 'One.').replace('Second paragraph.', 'Two.').replace('Third paragraph.', 'Three.'));
    expect(await status(proposals.act(id, 'rebase'))).toBe(409);
    expect((await proposals.act(id, 'drop')).hunks[0]?.state).toBe('dropped');
  });

  it('refuses to accept two hunks that now fall on the same text', async () => {
    const twice = '---\ntitle: Guide\n---\n\nA.\n\nX.\n\nM.\n\nX.\n\nB.\n';
    await writeFile(join(root, PATH), twice);
    const { id } = await proposals.propose({ path: PATH, content: twice.replaceAll('X.', 'Y.'), by: BY });
    await writeFile(join(root, PATH), twice.replace('M.\n\nX.\n\n', ''));
    expect(await status(proposals.act(id, 'accept'))).toBe(409);
    expect(await disk()).toBe(twice.replace('M.\n\nX.\n\n', ''));
    await proposals.act(id, 'accept', ['1']);
    expect(await disk()).toContain('Y.');
  });

  it('answers 404 for an unknown proposal or hunk', async () => {
    expect(await status(proposals.read('nope'))).toBe(404);
    expect(await status(proposals.read('../x'))).toBe(404);
    const { id } = await proposals.propose({ path: PATH, content: NOTE.replace('First paragraph.', 'One.'), by: BY });
    expect(await status(proposals.act(id, 'accept', ['9']))).toBe(404);
  });
});
