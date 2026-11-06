import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpError } from '#http.ts';
import type { Thread, ThreadAuthor } from '@fdbook/shared/review.ts';
import { createThreads, type Threads } from '#review/threads.ts';

const PATH = 'content/docs/guide.mdx';
const NOTE = '# Guide\n\nThe first paragraph says one thing.\n\nThe second paragraph says another.\n\nThe end.';
const REVIEWER: ThreadAuthor = { kind: 'run', runId: 'r1', agent: 'claude', model: 'opus', role: 'reviewer' };
const AUTHOR: ThreadAuthor = { kind: 'run', runId: 'r2', agent: 'codex', model: null, role: 'author' };
const PERSON: ThreadAuthor = { kind: 'person', login: 'thoai' };

// The note as reanchor reads it.
const note = (text: string | null) => () => Promise.resolve(text);
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: unknown) => (error as HttpError).status);

describe('review threads', () => {
  let base: string;
  let file: string;
  let threads: Threads;
  let changes: Thread[];

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'notes-studio-threads-'));
    file = join(base, 'comments', 'cr.jsonl');
    changes = [];
    threads = createThreads(file, { onChange: (thread) => changes.push(structuredClone(thread)) });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('opens a thread on a block, with its severity and rule, and says so', async () => {
    const thread = await threads.open({ path: PATH, text: NOTE, block: 2, body: '  Say why.  ', by: REVIEWER, severity: 'blocking', rule: 'voice.direct' });
    expect(thread).toMatchObject({ path: PATH, state: 'open', severity: 'blocking', rule: 'voice.direct', orphaned: false, suggestion: null });
    expect(thread.anchor).toMatchObject({ index: 2, text: 'The second paragraph says another.', before: 'The first paragraph says one thing.', after: 'The end.' });
    expect(thread.comments).toEqual([expect.objectContaining({ body: 'Say why.', by: REVIEWER })]);
    expect(await threads.list(PATH)).toEqual([thread]);
    expect(await threads.list('content/docs/other.mdx')).toEqual([]);
    expect(changes).toEqual([thread]);
  });

  it('refuses a block the note does not have, an empty body and a bad rule', async () => {
    expect(await status(threads.open({ path: PATH, text: NOTE, block: 9, body: 'x', by: PERSON }))).toBe(400);
    expect(await status(threads.open({ path: PATH, text: NOTE, block: null, body: '   ', by: PERSON }))).toBe(400);
    expect(await status(threads.open({ path: PATH, text: NOTE, body: 'x', by: PERSON, rule: 'Not A Code' }))).toBe(400);
    expect(await threads.list()).toEqual([]);
  });

  it('keeps every reply and move as the thread\'s history', async () => {
    const { id } = await threads.open({ path: PATH, text: NOTE, block: 1, body: 'Too vague.', by: REVIEWER, severity: 'nit' });
    await threads.reply(id, { body: 'Which part?', by: PERSON });
    await threads.move(id, { state: 'rejected', body: 'It is the summary line.', by: AUTHOR });
    await threads.move(id, { state: 'needs-decision', body: 'Still vague.', by: REVIEWER });
    const thread = await threads.move(id, { state: 'resolved', by: PERSON });
    expect(thread.state).toBe('resolved');
    expect(thread.comments.map((comment) => [comment.by.kind === 'run' ? comment.by.role : 'person', comment.state ?? null, comment.body])).toEqual([
      ['reviewer', null, 'Too vague.'],
      ['person', null, 'Which part?'],
      ['author', 'rejected', 'It is the summary line.'],
      ['reviewer', 'needs-decision', 'Still vague.'],
      ['person', 'resolved', ''],
    ]);
    // Kept on disk, not only in memory.
    expect(await createThreads(file).read(id)).toEqual(thread);
  });

  it('lets each one move a thread only as the table says', async () => {
    const { id } = await threads.open({ path: PATH, body: 'x', by: REVIEWER, severity: 'blocking' });
    // The author answers; it does not judge its own answer.
    expect(await status(threads.move(id, { state: 'resolved', by: AUTHOR }))).toBe(409);
    // A person's finding is not the reviewer's to withdraw; its own is.
    const persons = await threads.open({ path: PATH, body: 'Mine.', by: PERSON, severity: 'blocking' });
    expect(await status(threads.move(persons.id, { state: 'resolved', by: REVIEWER }))).toBe(409);
    const own = await threads.open({ path: PATH, body: 'Mine too.', by: REVIEWER });
    expect((await threads.move(own.id, { state: 'resolved', by: REVIEWER })).state).toBe('resolved');
    // The reviewer judges; it does not answer for the author.
    expect(await status(threads.move(id, { state: 'addressed', by: REVIEWER }))).toBe(409);
    expect(await status(threads.move(id, { state: 'rejected', by: REVIEWER, body: 'no' }))).toBe(409);
    // A rejection says why.
    expect(await status(threads.move(id, { state: 'rejected', by: AUTHOR }))).toBe(400);
    await threads.move(id, { state: 'addressed', by: AUTHOR, body: 'Fixed.', suggestion: 'p1' });
    expect((await threads.read(id)).suggestion).toBe('p1');
    await threads.move(id, { state: 'open', by: REVIEWER, body: 'Not quite.' });
    await threads.move(id, { state: 'rejected', by: AUTHOR, body: 'It is right.' });
    await threads.move(id, { state: 'needs-decision', by: REVIEWER, body: 'Keeping it.' });
    // Only a person decides.
    expect(await status(threads.move(id, { state: 'resolved', by: REVIEWER }))).toBe(409);
    expect(await status(threads.move(id, { state: 'open', by: AUTHOR }))).toBe(409);
    await threads.move(id, { state: 'open', by: PERSON, body: 'Fix it.' });
    expect(await status(threads.move('nope', { state: 'open', by: PERSON }))).toBe(404);
  });

  it('moves anchors with the note, orphans them when the block goes, and finds it again', async () => {
    const { id } = await threads.open({ path: PATH, text: NOTE, block: 2, body: 'x', by: REVIEWER });
    const whole = await threads.open({ path: PATH, body: 'On the whole note.', by: PERSON });
    changes = [];
    const edited = NOTE.replace('# Guide\n\n', '# Guide\n\nA new intro.\n\n').replace('says another', 'says something else');
    expect((await threads.reanchor(PATH, note(edited))).map((thread) => thread.id)).toEqual([id]);
    expect((await threads.read(id)).anchor).toMatchObject({ index: 3, text: 'The second paragraph says something else.' });
    // Nothing moved: nothing said.
    expect(await threads.reanchor(PATH, note(edited))).toEqual([]);
    const gone = edited.replace('The second paragraph says something else.\n\n', '');
    await threads.reanchor(PATH, note(gone));
    const orphan = await threads.read(id);
    expect(orphan).toMatchObject({ orphaned: true, state: 'open', anchor: { text: 'The second paragraph says something else.' } });
    await threads.reanchor(PATH, note(edited));
    expect(await threads.read(id)).toMatchObject({ orphaned: false, anchor: { index: 3 } });
    // The note deleted orphans its threads; one on the whole note has no block to lose.
    await threads.reanchor(PATH, note(null));
    expect((await threads.read(id)).orphaned).toBe(true);
    expect(await threads.read(whole.id)).toEqual(whole);
    // A note that does not parse leaves them be.
    expect(await threads.reanchor(PATH, note('<Broken\n'))).toEqual([]);
    expect(changes.map((thread) => [thread.id, thread.orphaned])).toEqual([[id, false], [id, true], [id, false], [id, true]]);
  });

  it('reads a comment of #85 as an open thread of one comment', async () => {
    const old = { id: 'old-1', path: PATH, block: { index: 2, text: 'The second paragraph says another.' }, body: 'Old.', by: { kind: 'run', runId: 'r1', agent: 'claude', model: 'm' }, createdMs: 5 };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(old)}\nnot json\n`);
    const [thread] = await threads.list();
    expect(thread).toMatchObject({ id: 'old-1', state: 'open', severity: null, anchor: { index: 2, text: old.block.text }, comments: [{ body: 'Old.', by: { agent: 'claude', role: 'reviewer' } }] });
    // Its anchor is completed the first time the note is read for it.
    await threads.reanchor(PATH, note(NOTE));
    expect((await threads.read('old-1')).anchor).toMatchObject({ before: 'The first paragraph says one thing.', after: 'The end.' });
    await threads.reply('old-1', { body: 'Now a thread.', by: PERSON });
    expect((await readFile(file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('takes no sibling that reads alike for an orphaned thread, edited after the orphaning', async () => {
    const x = 'The cache keeps every page for an hour before it reads the source again.';
    const sibling = x.replace('page', 'image');
    const v1 = `Intro.\n\n${x}\n\nMiddle.\n\n${sibling}\n\nEnd.\n`;
    const { id } = await threads.open({ path: PATH, text: v1, block: 1, body: 'x', by: REVIEWER });
    const v2 = v1.replace(`${x}\n\n`, '');
    await threads.reanchor(PATH, note(v2));
    expect((await threads.read(id)).orphaned).toBe(true);
    await threads.reanchor(PATH, note(v2.replace('again.', 'again later.')));
    expect(await threads.read(id)).toMatchObject({ orphaned: true, anchor: { text: x } });
    // The block itself coming back is found.
    await threads.reanchor(PATH, note(v1));
    expect(await threads.read(id)).toMatchObject({ orphaned: false, anchor: { index: 1, text: x } });
  });

  it('finds the block at the new path when the watcher saw the rename first', async () => {
    const { id } = await threads.open({ path: PATH, text: NOTE, block: 2, body: 'x', by: REVIEWER });
    // The old path's unlink, then the new path's add (no thread there yet), then the move.
    await threads.reanchor(PATH, note(null));
    await threads.reanchor('content/docs/handbook.mdx', note(NOTE));
    await threads.moved('guide.mdx', 'handbook.mdx', () => Promise.resolve(NOTE));
    expect(await threads.read(id)).toMatchObject({ path: 'content/docs/handbook.mdx', orphaned: false, anchor: { index: 2 } });
  });

  it('keeps a thread orphaned before a rename orphaned through it, and finds one whose own block the rename changed', async () => {
    const x = 'The cache keeps every page for an hour before it reads the source again.';
    const sibling = x.replace('page', 'image');
    const v1 = `Intro.\n\n${x}\n\nMiddle.\n\n${sibling}\n\nEnd.\n`;
    const old = await threads.open({ path: PATH, text: v1, block: 1, body: 'x', by: REVIEWER });
    const v2 = v1.replace(`${x}\n\n`, '');
    await threads.reanchor(PATH, note(v2));
    const v3 = v2.replace('again.', 'again later.');
    await threads.reanchor(PATH, note(v3));
    await threads.moved('guide.mdx', 'handbook.mdx', () => Promise.resolve(v3));
    expect(await threads.read(old.id)).toMatchObject({ path: 'content/docs/handbook.mdx', orphaned: true, anchor: { text: x } });
    // Orphaned by the rename's own unlink, with its block changed by the rename (a link to itself).
    const page = 'Read [this page](./guide.mdx) first.';
    const linked = `Intro.\n\n${page}\n\nEnd.\n`;
    const own = await threads.open({ path: 'content/docs/a.mdx', text: linked, block: 1, body: 'y', by: REVIEWER });
    await threads.reanchor('content/docs/a.mdx', note(null));
    const rewritten = linked.replace('./guide.mdx', './b.mdx');
    await threads.moved('a.mdx', 'b.mdx', () => Promise.resolve(rewritten));
    expect(await threads.read(own.id)).toMatchObject({ path: 'content/docs/b.mdx', orphaned: false, anchor: { index: 1, text: 'Read [this page](./b.mdx) first.' } });
  });

  it('reads no note that has no threads, and each change is later than the last', async () => {
    const read = vi.fn(() => Promise.resolve(NOTE));
    expect(await threads.reanchor(PATH, read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    const { id, updatedMs } = await threads.open({ path: PATH, text: NOTE, block: 2, body: 'x', by: REVIEWER });
    await threads.reanchor(PATH, note(NOTE.replace('says another', 'says more')));
    const moved = await threads.read(id);
    expect(moved.updatedMs).toBeGreaterThan(updatedMs);
    expect((await threads.reply(id, { body: 'y', by: PERSON })).updatedMs).toBeGreaterThan(moved.updatedMs);
  });

  it('moves the threads of a renamed page or folder with it', async () => {
    const page = await threads.open({ path: PATH, body: 'Page.', by: PERSON });
    const inFolder = await threads.open({ path: 'content/docs/guide/deep.mdx', body: 'In the folder.', by: PERSON });
    const other = await threads.open({ path: 'content/docs/guides.mdx', body: 'Not in it.', by: PERSON });
    const read = () => Promise.resolve(null);
    await threads.moved('guide.mdx', 'handbook.mdx', read);
    await threads.moved('guide', 'handbook', read);
    expect((await threads.list()).map((thread) => [thread.id, thread.path])).toEqual([
      [page.id, 'content/docs/handbook.mdx'],
      [inFolder.id, 'content/docs/handbook/deep.mdx'],
      [other.id, 'content/docs/guides.mdx'],
    ]);
  });

  it('writes nothing once closed, so a discard that removed the file stays removed', async () => {
    const { id } = await threads.open({ path: PATH, text: NOTE, block: 2, body: 'x', by: REVIEWER });
    threads.close();
    await rm(file);
    expect(await threads.reanchor(PATH, note(NOTE.replace('says another', 'says more')))).toEqual([]);
    expect(await status(threads.reply(id, { body: 'late', by: PERSON }))).toBe(409);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('writes one change at a time', async () => {
    const { id } = await threads.open({ path: PATH, body: 'x', by: PERSON });
    await Promise.all(Array.from({ length: 10 }, (_each, index) => threads.reply(id, { body: `reply ${String(index)}`, by: PERSON })));
    expect((await threads.read(id)).comments).toHaveLength(11);
  });
});
