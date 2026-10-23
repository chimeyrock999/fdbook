import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createKeyedLock } from '../files/store.ts';
import type { ProposalAuthor } from './shared.ts';

// A comment on a note of the change request, from an agent or a person,
// anchored to one block by its text when it names one. The first step of
// review threads (#87), which add replies, states and the review panel.
export type NoteComment = {
  id: string;
  path: string;
  block: { index: number; text: string } | null;
  body: string;
  by: ProposalAuthor;
  createdMs: number;
};

const MAX_BODY = 10_000;

// The comments of one change request, one JSON line each in `file`,
// outside its worktree.
export function createComments(file: string, onAdd?: (comment: NoteComment) => void) {
  const lock = createKeyedLock();
  const read = async (): Promise<NoteComment[]> => {
    const text = await readFile(file, 'utf8').catch(() => '');
    return text.split('\n').flatMap((line) => {
      try {
        return line === '' ? [] : [JSON.parse(line) as NoteComment];
      } catch {
        return [];
      }
    });
  };
  return {
    async list(path?: string) {
      return (await read()).filter((comment) => path === undefined || comment.path === path);
    },
    add(comment: Omit<NoteComment, 'id' | 'createdMs'>) {
      const body = comment.body.trim();
      if (body === '') throw new Error('a comment needs some text');
      const stored: NoteComment = { ...comment, body: body.slice(0, MAX_BODY), id: `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`, createdMs: Date.now() };
      return lock('append', async () => {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(stored)}\n`);
        onAdd?.(stored);
        return stored;
      });
    },
    remove: () => rm(file, { force: true }),
  };
}

export type Comments = ReturnType<typeof createComments>;
