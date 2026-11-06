import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '#files/store.ts';
import { summaryOf, type Conversation, type ConversationEvent, type ConversationTotals } from '@fdbook/shared/agents.ts';
import type { StoredChange } from './watch.ts';

const ID = /^[a-z0-9-]+$/;

// A summary as stored. One written before conversations (#130) is a run:
// one prompt, one turn, no session kept.
export function conversationOf(stored: Conversation | Omit<Conversation, 'lastMs' | 'turns' | 'sessionId' | 'live'>): Conversation {
  return { lastMs: stored.endedMs ?? stored.startedMs, turns: 1, sessionId: null, ...stored, live: false };
}

type StoredRun = Omit<Conversation, 'lastMs' | 'turns' | 'sessionId' | 'live'>;
type Stored = ConversationEvent | { type: 'start' | 'summary' | 'end'; at: number; run: StoredRun };

// An event as stored, in today's shape: a run's summary is a conversation's.
function eventOf(stored: Stored): ConversationEvent {
  if (!('run' in stored)) return stored;
  const conversation = conversationOf(stored.run);
  if (stored.type !== 'end') return { type: stored.type, at: stored.at, conversation };
  const { status, error, cost, usage, writes } = stored.run;
  return { type: 'end', at: stored.at, conversation, turn: { status: status === 'running' ? 'failed' : status, error, cost, usage, writes } };
}

// Where conversations are kept: <home>/agents/<slug>/, next to the
// worktrees and outside the change request's branch, so a transcript never
// lands in a diff or a pull request. Per conversation, <id>.jsonl holds
// every event in order, <id>.json the summary as last known, and
// <id>.t<n>.changes.json what turn n changed (watch.ts), for Keep/Revert.
export function createTranscripts(home: string) {
  const dirOf = (slug: string) => join(home, 'agents', slug);
  // Events wait here per conversation, and go to disk in one append each
  // time its queue gets to them: a streamed answer is many small events.
  const waiting = new Map<string, { slug: string; id: string; events: ConversationEvent[] }>();
  // One flush at a time per conversation, in order.
  const queues = new Map<string, Promise<void>>();

  const flush = async (key: string) => {
    const batch = waiting.get(key);
    waiting.delete(key);
    if (batch === undefined) return;
    await mkdir(dirOf(batch.slug), { recursive: true });
    await appendFile(join(dirOf(batch.slug), `${batch.id}.jsonl`), batch.events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const summary = [...batch.events].reverse().map(summaryOf).find((each) => each !== null);
    if (summary !== undefined) await writeAtomic(join(dirOf(batch.slug), `${batch.id}.json`), `${JSON.stringify(summary)}\n`);
  };

  // Every conversation of the change request, last active first.
  const list = async (slug: string): Promise<Conversation[]> => {
    const names = await readdir(dirOf(slug)).catch(() => []);
    const conversations = await Promise.all(
      names.filter((name) => name.endsWith('.json') && !name.endsWith('.changes.json')).map((name) =>
        readFile(join(dirOf(slug), name), 'utf8').then((text) => conversationOf(JSON.parse(text) as Conversation), () => null),
      ),
    );
    return conversations.filter((conversation) => conversation !== null).sort((a, b) => b.lastMs - a.lastMs);
  };

  const settled = () => Promise.all(queues.values()).then(() => undefined);

  return {
    // Queues `event` for the conversation's transcript; `settled` waits for it on disk.
    append(slug: string, id: string, event: ConversationEvent) {
      const key = `${slug}/${id}`;
      const batch = waiting.get(key);
      if (batch !== undefined) {
        batch.events.push(event);
        return;
      }
      waiting.set(key, { slug, id, events: [event] });
      const next = (queues.get(key) ?? Promise.resolve()).then(() => flush(key)).catch(() => undefined);
      queues.set(key, next);
      void next.then(() => { if (queues.get(key) === next) queues.delete(key); });
    },

    list,

    // A conversation's events, or null when there is no such conversation.
    // A line cut short by a crash is left out. A run kept before
    // conversations gets the turn its prompt began.
    async read(slug: string, id: string): Promise<ConversationEvent[] | null> {
      if (!ID.test(id)) return null;
      const text = await readFile(join(dirOf(slug), `${id}.jsonl`), 'utf8').catch(() => null);
      if (text === null) return null;
      const events = text.split('\n').flatMap((line) => {
        try {
          return line === '' ? [] : [eventOf(JSON.parse(line) as Stored)];
        } catch {
          return [];
        }
      });
      // Each turn of a conversation begins right after its start; a run's prompt did not.
      const start = events.at(0);
      if (start?.type === 'start' && events.at(1)?.type !== 'turn') {
        events.splice(1, 0, { type: 'turn', at: start.at, prompt: start.conversation.prompt, by: start.conversation.by });
      }
      return events;
    },

    // Conversations and cost of every change request with any, for the
    // list of change requests. Costs add up per currency; a conversation
    // without a cost counts in `conversations` only.
    async totals(): Promise<Record<string, ConversationTotals>> {
      const slugs = await readdir(join(home, 'agents')).catch(() => []);
      const entries = await Promise.all(
        slugs.map(async (slug) => {
          const conversations = await list(slug);
          const costs: Record<string, number> = {};
          for (const each of conversations) if (each.cost !== null) costs[each.cost.currency] = (costs[each.cost.currency] ?? 0) + each.cost.amount;
          return [slug, { conversations: conversations.length, costs }] as const;
        }),
      );
      return Object.fromEntries(entries.filter(([, totals]) => totals.conversations > 0));
    },

    // What a turn changed, for Keep/Revert (watch.ts).
    writeChanges: async (slug: string, id: string, turn: number, changes: StoredChange[]) => {
      await mkdir(dirOf(slug), { recursive: true });
      await writeAtomic(join(dirOf(slug), `${id}.t${String(turn)}.changes.json`), `${JSON.stringify(changes)}\n`);
    },
    // A run kept before conversations has its changes in <id>.changes.json:
    // they are its one turn's, until a decision writes them as turn 1's.
    async readChanges(slug: string, id: string, turn: number): Promise<StoredChange[] | null> {
      if (!ID.test(id) || !Number.isInteger(turn)) return null;
      const text = (await readFile(join(dirOf(slug), `${id}.t${String(turn)}.changes.json`), 'utf8').catch(() => null))
        ?? (turn === 1 ? await readFile(join(dirOf(slug), `${id}.changes.json`), 'utf8').catch(() => null) : null);
      return text === null ? null : (JSON.parse(text) as StoredChange[]);
    },

    // Waits for the appends in flight, so a read after it sees them.
    settled,

    // One conversation's files, once its appends are on disk.
    async removeOne(slug: string, id: string) {
      if (!ID.test(id)) return;
      await settled();
      const turns = (await readdir(dirOf(slug)).catch(() => [])).filter((name) => name.startsWith(`${id}.t`) && name.endsWith('.changes.json'));
      await Promise.all([`${id}.jsonl`, `${id}.json`, `${id}.changes.json`, ...turns].map((name) => rm(join(dirOf(slug), name), { force: true })));
    },

    remove: (slug: string) => rm(dirOf(slug), { recursive: true, force: true }),
  };
}

export type Transcripts = ReturnType<typeof createTranscripts>;
