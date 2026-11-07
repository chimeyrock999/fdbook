import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createKeyedLock, writeAtomic } from '#services/files/store.ts';
import { HttpError } from '#infra/http.ts';
import { blocksOf } from '@fdbook/shared/hunks.ts';
import { NOTES_DIR } from '#infra/security/paths.ts';
import type { ProposalAuthor } from '@fdbook/shared/proposals.ts';
import { anchorAt, locate, type Anchor } from '@fdbook/shared/anchors.ts';
import { moverOf, movesOf, needsReason, type Thread, type ThreadAuthor, type ThreadComment, type ThreadSeverity, type ThreadState } from '@fdbook/shared/review.ts';

const MAX_BODY = 10_000;
// A code of the style guide's checklist (#90), e.g. `voice.direct`.
const RULE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const newId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

// The anchor of block `block` of `text` for a new thread, refused as the
// thread would be: a rule that is no checklist code, a note that does not
// parse, a block it does not have. Null for the note as a whole.
export function anchorFor(path: string, text: string, block: number | null, rule: string | null = null) {
  if (rule !== null && !RULE.test(rule)) throw new HttpError(400, `a rule is a checklist code such as voice.direct, not ${JSON.stringify(rule)}`);
  if (block === null) return null;
  let blocks;
  try {
    blocks = blocksOf(text);
  } catch {
    throw new HttpError(422, `${path} does not parse: comment on the note as a whole`);
  }
  if (block >= blocks.length) throw new HttpError(400, `${path} has ${String(blocks.length)} blocks (0 to ${String(blocks.length - 1)})`);
  return anchorAt(blocks, block);
}

// A thread's next updatedMs: later than the last, even within one millisecond,
// so a client keeps the newest copy of it (useProposals).
const after = (previous: number) => Math.max(Date.now(), previous + 1);

function bodyOf(body: string) {
  const trimmed = body.trim();
  if (trimmed === '') throw new HttpError(400, 'a comment needs some text');
  return trimmed.slice(0, MAX_BODY);
}

// A comment of #85, before threads: one open thread of one comment, its
// block anchored by text alone.
type OldComment = { id: string; path: string; block: { index: number; text: string } | null; body: string; by: ProposalAuthor; createdMs: number };

function fromOld(old: OldComment): Thread {
  const by: ThreadAuthor = old.by.kind === 'run' ? { ...old.by, role: 'reviewer' } : old.by;
  return {
    id: old.id,
    path: old.path,
    anchor: old.block === null ? null : { index: old.block.index, text: old.block.text, before: null, after: null, seen: [] },
    orphaned: false,
    severity: null,
    rule: null,
    state: 'open',
    suggestion: null,
    comments: [{ id: old.id, body: old.body, by, createdMs: old.createdMs }],
    createdMs: old.createdMs,
    updatedMs: old.createdMs,
  };
}

export type ThreadsOptions = {
  // Each thread as it is opened or changes, its anchor moved included.
  onChange?: (thread: Thread) => void;
};

// The review threads of one change request, one JSON line each in `file`,
// outside its worktree, read once and kept: the workspace is the file's
// only writer. Every change writes the file whole to a temp file and
// renames it, so a crash leaves the old threads and not half of them.
// Once closed (the change request is being discarded) nothing is written.
export function createThreads(file: string, { onChange }: ThreadsOptions = {}) {
  const lock = createKeyedLock();
  let kept: Thread[] | null = null;
  let closed = false;
  // The threads orphaned only because their note went (an unlink), until
  // a move or the note's return settles them: the watcher may report a
  // rename before the tree says where the note went (moved).
  const unlinked = new Set<string>();
  const read = async (): Promise<Thread[]> => {
    kept ??= await load();
    return structuredClone(kept);
  };
  const load = async (): Promise<Thread[]> => {
    const text = await readFile(file, 'utf8').catch(() => '');
    return text.split('\n').flatMap((line) => {
      try {
        if (line === '') return [];
        const value = JSON.parse(line) as Thread | OldComment;
        return ['comments' in value ? value : fromOld(value)];
      } catch {
        return [];
      }
    });
  };
  const write = async (threads: Thread[]) => {
    if (closed) throw new HttpError(409, 'this change request is closing');
    await writeAtomic(file, threads.map((thread) => `${JSON.stringify(thread)}\n`).join(''));
    kept = structuredClone(threads);
  };
  // Changes one thread under the lock and says so.
  const change = (id: string, edit: (thread: Thread) => void) =>
    lock('threads', async () => {
      const threads = await read();
      const thread = threads.find((each) => each.id === id);
      if (thread === undefined) throw new HttpError(404, `no such thread: ${id}`);
      edit(thread);
      thread.updatedMs = after(thread.updatedMs);
      await write(threads);
      onChange?.(thread);
      return thread;
    });

  return {
    async list(path?: string) {
      return (await read()).filter((thread) => path === undefined || thread.path === path);
    },
    async read(id: string) {
      const thread = (await read()).find((each) => each.id === id);
      if (thread === undefined) throw new HttpError(404, `no such thread: ${id}`);
      return thread;
    },
    // A new thread, on block `block` of `text` (the note as the one who
    // comments sees it), or on the note as a whole.
    async open({ path, text, block, anchor: given, body, by, severity = null, rule = null, suggestion = null }: { path: string; text?: string; block?: number | null; anchor?: Anchor | null; body: string; by: ThreadAuthor; severity?: ThreadSeverity | null; rule?: string | null; suggestion?: string | null }) {
      const anchor = anchorFor(path, text ?? '', block ?? null, rule) ?? given ?? null;
      const now = Date.now();
      const comment: ThreadComment = { id: newId(), body: bodyOf(body), by, createdMs: now };
      const thread: Thread = { id: comment.id, path, anchor, orphaned: false, severity, rule, state: 'open', suggestion, comments: [comment], createdMs: now, updatedMs: now };
      return await lock('threads', async () => {
        await write([...(await read()), thread]);
        onChange?.(thread);
        return thread;
      });
    },
    async reply(id: string, { body, by, suggestion }: { body: string; by: ThreadAuthor; suggestion?: string | null }) {
      const text = bodyOf(body);
      return await change(id, (thread) => {
        thread.comments.push({ id: newId(), body: text, by, createdMs: Date.now() });
        if (suggestion != null) thread.suggestion = suggestion;
      });
    },
    // Moves thread `id` to `state`, as the table of shared.ts lets `by`; a
    // rejection needs a reason in `body`.
    async move(id: string, { state, body = '', by, suggestion }: { state: ThreadState; body?: string; by: ThreadAuthor; suggestion?: string | null }) {
      if (needsReason(state) && body.trim() === '') throw new HttpError(400, 'say why the thread is rejected');
      return await change(id, (thread) => {
        const allowed = movesOf(thread, moverOf(by));
        if (!allowed.includes(state)) {
          const who = by.kind === 'person' ? 'a person' : `the ${by.role} agent`;
          throw new HttpError(409, `${who} cannot take a thread from ${thread.state} to ${state}${allowed.length === 0 ? '' : ` (it may go to ${allowed.join(', ')})`}`);
        }
        thread.state = state;
        thread.comments.push({ id: newId(), body: body.trim().slice(0, MAX_BODY), by, createdMs: Date.now(), state });
        if (suggestion != null) thread.suggestion = suggestion;
      });
    },
    // Moves the anchors of the threads on `path` to where its blocks are in
    // the note as `readNote` reads it now (null: it is gone), and says which
    // threads changed. A note that does not parse leaves them as they are.
    // The note is read under the lock, so two changes close together are
    // never applied in the wrong order; a note without threads is not read.
    reanchor(path: string, readNote: () => Promise<string | null>) {
      return lock('threads', async () => {
        const threads = await read();
        if (closed || !threads.some((thread) => thread.path === path && thread.anchor !== null)) return [];
        const text = await readNote();
        let blocks: { text: string }[] | null = null;
        if (text !== null) {
          try {
            blocks = blocksOf(text);
          } catch {
            return [];
          }
        }
        const changed: Thread[] = [];
        for (const thread of threads) {
          if (thread.path !== path || thread.anchor === null) continue;
          const found = blocks === null ? null : locate(thread.anchor, blocks, thread.orphaned);
          const anchor = blocks === null || found === null ? thread.anchor : anchorAt(blocks, found);
          const orphaned = found === null;
          if (blocks === null && !thread.orphaned) unlinked.add(thread.id);
          if (!orphaned) unlinked.delete(thread.id);
          if (orphaned === thread.orphaned && JSON.stringify(anchor) === JSON.stringify(thread.anchor)) continue;
          Object.assign(thread, { anchor, orphaned, updatedMs: after(thread.updatedMs) });
          changed.push(thread);
        }
        if (changed.length === 0) return changed;
        await write(threads);
        for (const thread of changed) onChange?.(thread);
        return changed;
      });
    },
    // A page (`x.mdx`) or folder (`x`) the tree moved, relative to
    // content/notes: its threads go with it, placed on the notes at their
    // new paths as `readNote` reads them. The watcher may have seen the
    // rename first and orphaned them on the old path: that loss was the
    // move, so those are placed as if they had never lost their block (the
    // rename may have rewritten a link in it); one orphaned before keeps
    // the orphaned rule (anchors.ts).
    moved(from: string, to: string, readNote: (path: string) => Promise<string | null>) {
      const [old, now] = [`${NOTES_DIR}/${from}`, `${NOTES_DIR}/${to}`];
      return lock('threads', async () => {
        const threads = await read();
        const changed = threads.filter((thread) => thread.path === old || thread.path.startsWith(`${old}/`));
        if (changed.length === 0 || closed) return;
        const notes = new Map<string, { text: string }[] | null>();
        for (const thread of changed) {
          const path = now + thread.path.slice(old.length);
          if (!notes.has(path)) notes.set(path, await readNote(path).then((text) => (text === null ? null : blocksOf(text))).catch(() => null));
          const blocks = notes.get(path) ?? null;
          const found = blocks === null || thread.anchor === null ? null : locate(thread.anchor, blocks, thread.orphaned && !unlinked.has(thread.id));
          unlinked.delete(thread.id);
          Object.assign(thread, { path, updatedMs: after(thread.updatedMs), ...(blocks !== null && found !== null ? { anchor: anchorAt(blocks, found), orphaned: false } : {}) });
        }
        await write(threads);
        for (const thread of changed) onChange?.(thread);
      });
    },
    close() {
      closed = true;
    },
  };
}

export type Threads = ReturnType<typeof createThreads>;
