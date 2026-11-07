import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '#infra/http.ts';
import { ATTACHMENT_MAX_BYTES, type Attachment, type ConversationEvent } from '@fdbook/shared/agents.ts';

const ID = /^[a-f0-9]{16}$/;
const NAME_MAX = 120;
// An attachment no message sent is kept this long, for the message being written.
const UNSENT_MS = 60 * 60_000;

// The attachments the messages among `events` carried.
export const sentIn = (events: ConversationEvent[]) => events.flatMap((event) => (event.type === 'turn' ? (event.context?.attachments ?? []).map((each) => each.id) : []));

// A file name as kept: its last segment, without control characters or
// separators, and not one of `.` or `..`.
export function attachmentName(given: string) {
  const last = given.split(/[\\/]/).at(-1) ?? '';
  // eslint-disable-next-line no-control-regex
  const name = last.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-NAME_MAX);
  if (name === '' || name === '.' || name === '..') throw new HttpError(400, 'an attachment needs a file name');
  return name;
}

// Documents attached to messages, per change request:
// <home>/agents/<slug>/attachments/<id>/<name>, next to the transcripts and
// outside the worktree, so they never land in a commit. The agent gets the
// file in its prompt (attachment-blocks.ts). They go once no conversation
// has them: when one is deleted, every attachment none of the others sent
// goes, unless it is new (unsent yet); and with the change request.
export function createAttachments(home: string) {
  const dirOf = (slug: string) => join(home, 'agents', slug, 'attachments');

  return {
    async save(slug: string, given: string, bytes: Buffer): Promise<Attachment> {
      if (bytes.length === 0) throw new HttpError(400, 'the attachment is empty');
      if (bytes.length > ATTACHMENT_MAX_BYTES) throw new HttpError(413, `an attachment must be at most ${String(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
      const name = attachmentName(given);
      const id = randomBytes(8).toString('hex');
      await mkdir(join(dirOf(slug), id), { recursive: true });
      await writeFile(join(dirOf(slug), id, name), bytes, { flag: 'wx' });
      return { id, name, size: bytes.length };
    },

    // The attachment as kept, with its absolute path, or null when it is gone.
    async find(slug: string, id: string): Promise<(Attachment & { absolute: string }) | null> {
      if (!ID.test(id)) return null;
      const names = await readdir(join(dirOf(slug), id)).catch(() => []);
      const name = names.at(0);
      if (name === undefined) return null;
      const absolute = join(dirOf(slug), id, name);
      const info = await stat(absolute).catch(() => null);
      return info?.isFile() ? { id, name, size: info.size, absolute } : null;
    },

    // Removes every attachment no conversation keeps (`kept`): those
    // `gone` (sent by a deleted one) at once, the others once an hour old.
    async sweep(slug: string, kept: Set<string>, gone: Set<string>, now = Date.now()) {
      const ids = (await readdir(dirOf(slug)).catch(() => [])).filter((id) => ID.test(id) && !kept.has(id));
      await Promise.all(ids.map(async (id) => {
        const info = await stat(join(dirOf(slug), id)).catch(() => null);
        if (info !== null && (gone.has(id) || now - info.mtimeMs >= UNSENT_MS)) await rm(join(dirOf(slug), id), { recursive: true, force: true });
      }));
    },
  };
}

export type Attachments = ReturnType<typeof createAttachments>;
