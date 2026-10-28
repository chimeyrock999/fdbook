import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpError } from '../../../server/http';
import { createComments, type Comments } from '../../../server/proposals/comments';

const PATH = 'content/notes/guide.mdx';
const BY = { kind: 'run', runId: 'r1', agent: 'claude', model: 'fake-1' } as const;

describe('comments', () => {
  let base: string;
  let file: string;
  let comments: Comments;
  let resolved: string[];

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'notes-studio-comments-'));
    file = join(base, 'comments', 'cr.jsonl');
    resolved = [];
    comments = createComments(file, undefined, (id) => resolved.push(id));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('resolves one comment, keeps the others, and says so', async () => {
    const first = await comments.add({ path: PATH, block: null, body: 'One.', by: BY });
    const second = await comments.add({ path: PATH, block: null, body: 'Two.', by: BY });
    await comments.resolve(first.id);
    expect((await comments.list()).map((each) => each.id)).toEqual([second.id]);
    expect(resolved).toEqual([first.id]);
    expect(await readFile(file, 'utf8')).toBe(`${JSON.stringify(second)}\n`);
    // Written through a temp file, which is gone after the rename.
    expect(await readdir(join(base, 'comments'))).toEqual(['cr.jsonl']);
    await comments.resolve(second.id);
    expect(await readFile(file, 'utf8')).toBe('');
    expect(await comments.list()).toEqual([]);
  });

  it('refuses an unknown or already resolved comment with 404', async () => {
    const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: unknown) => (error as HttpError).status);
    const added = await comments.add({ path: PATH, block: null, body: 'One.', by: BY });
    await comments.resolve(added.id);
    expect(await status(comments.resolve(added.id))).toBe(404);
    expect(await status(comments.resolve('nope'))).toBe(404);
    expect(resolved).toEqual([added.id]);
  });
});
