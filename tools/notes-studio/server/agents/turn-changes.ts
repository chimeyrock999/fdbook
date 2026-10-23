import { join } from 'node:path';
import { createKeyedLock } from '../files/store.ts';
import { HttpError } from '../http.ts';
import type { TurnChange } from './shared.ts';
import type { Transcripts } from './transcripts.ts';
import { revertChange } from './watch.ts';

// Keep/Revert of what one turn of a conversation changed (watch.ts keeps
// what each file held when the turn began). `going`: whether that turn is
// still going, so its changes are not settled yet. `decided` hears each
// decision: a revert is a person's edit to the turns going on, and either
// ends a note's life as the agent's own draft.
export function createTurnChanges(root: string, { slug, transcripts, lock, pathLock, going, decided }: {
  slug: string;
  transcripts: Transcripts;
  lock: ReturnType<typeof createKeyedLock>;
  pathLock: ReturnType<typeof createKeyedLock>;
  going: (id: string, turn: number) => boolean;
  decided: (id: string, turn: number, path: string, op: 'keep' | 'revert') => void;
}) {
  // An ended turn's changes; none while it runs.
  const stored = async (id: string, turn: number) => {
    if (going(id, turn)) throw new HttpError(409, 'the turn is still going: wait for its end');
    await transcripts.settled();
    return (await transcripts.readChanges(slug, id, turn)) ?? [];
  };

  return {
    // The files an ended turn changed, for Keep/Revert.
    async changes(id: string, turn: number): Promise<TurnChange[]> {
      return (await stored(id, turn)).map(({ path, before, decided, reason }) => ({ path, existed: before !== null, decided, reason }));
    },

    // What `path` held before the turn, as text (null: it did not exist).
    async before(id: string, turn: number, path: string) {
      const change = (await stored(id, turn)).find((each) => each.path === path);
      if (change === undefined) throw new HttpError(404, `the turn did not change ${path}`);
      return { path, content: change.before === null ? null : Buffer.from(change.before, 'base64').toString('utf8') };
    },

    // Keeps a change, or puts the file back as it was before the turn. A
    // file changed again since the turn ended (by a later turn too) is not
    // reverted (409).
    decide(id: string, turn: number, path: string, op: unknown) {
      if (op !== 'keep' && op !== 'revert') throw new HttpError(400, 'op must be keep or revert');
      return lock('notes', async () => {
        const changes = await stored(id, turn);
        const change = changes.find((each) => each.path === path);
        if (change === undefined) throw new HttpError(404, `the turn did not change ${path}`);
        if (change.decided !== null) throw new HttpError(409, `${path} was already ${change.decided}`);
        if (op === 'revert') {
          let reverted;
          try {
            reverted = await pathLock(join(root, path), () => revertChange(root, change));
          } catch (error) {
            throw new HttpError(409, (error as Error).message);
          }
          if (!reverted) throw new HttpError(409, `${path} changed since the turn ended: revert it by hand, or keep it`);
        }
        change.decided = op === 'keep' ? 'kept' : 'reverted';
        await transcripts.writeChanges(slug, id, turn, changes);
        decided(id, turn, path, op);
        return { path, existed: change.before !== null, decided: change.decided, reason: change.reason } satisfies TurnChange;
      });
    },
  };
}
