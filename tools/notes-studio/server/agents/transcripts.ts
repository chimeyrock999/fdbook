import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '../files/store.ts';
import type { RunEvent, RunSummary, RunTotals } from './shared.ts';

// Where runs are kept: <home>/agents/<slug>/, next to the worktrees and
// outside the change request's branch, so a transcript never lands in a
// diff or a pull request. Per run, <id>.jsonl holds every event in order
// and <id>.json the summary as last known.
export function createTranscripts(home: string) {
  const dirOf = (slug: string) => join(home, 'agents', slug);
  // Events wait here per run, and go to disk in one append each time the
  // run's queue gets to them: a streamed answer is many small events.
  const waiting = new Map<string, { slug: string; runId: string; events: RunEvent[] }>();
  // One flush at a time per run, in order.
  const queues = new Map<string, Promise<void>>();

  const flush = async (key: string) => {
    const batch = waiting.get(key);
    waiting.delete(key);
    if (batch === undefined) return;
    await mkdir(dirOf(batch.slug), { recursive: true });
    await appendFile(join(dirOf(batch.slug), `${batch.runId}.jsonl`), batch.events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const summary = [...batch.events].reverse().find((event) => event.type === 'start' || event.type === 'summary' || event.type === 'end');
    if (summary !== undefined) await writeAtomic(join(dirOf(batch.slug), `${batch.runId}.json`), `${JSON.stringify(summary.run)}\n`);
  };

  // Every run of the change request, newest first.
  const list = async (slug: string): Promise<RunSummary[]> => {
    const names = await readdir(dirOf(slug)).catch(() => []);
    const runs = await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) =>
        readFile(join(dirOf(slug), name), 'utf8').then((text) => JSON.parse(text) as RunSummary, () => null),
      ),
    );
    return runs.filter((run) => run !== null).sort((a, b) => b.startedMs - a.startedMs);
  };

  return {
    // Queues `event` for the run's transcript; `settled` waits for it on disk.
    append(slug: string, runId: string, event: RunEvent) {
      const key = `${slug}/${runId}`;
      const batch = waiting.get(key);
      if (batch !== undefined) {
        batch.events.push(event);
        return;
      }
      waiting.set(key, { slug, runId, events: [event] });
      const next = (queues.get(key) ?? Promise.resolve()).then(() => flush(key)).catch(() => undefined);
      queues.set(key, next);
      void next.then(() => { if (queues.get(key) === next) queues.delete(key); });
    },

    list,

    // A run's events, or null when there is no such run. A line cut short
    // by a crash is left out.
    async read(slug: string, runId: string): Promise<RunEvent[] | null> {
      if (!/^[a-z0-9-]+$/.test(runId)) return null;
      const text = await readFile(join(dirOf(slug), `${runId}.jsonl`), 'utf8').catch(() => null);
      if (text === null) return null;
      return text.split('\n').flatMap((line) => {
        try {
          return line === '' ? [] : [JSON.parse(line) as RunEvent];
        } catch {
          return [];
        }
      });
    },

    // Runs and cost of every change request with runs, for the list of
    // change requests. Costs add up per currency; a run without a cost
    // counts in `runs` only.
    async totals(): Promise<Record<string, RunTotals>> {
      const slugs = await readdir(join(home, 'agents')).catch(() => []);
      const entries = await Promise.all(
        slugs.map(async (slug) => {
          const runs = await list(slug);
          const costs: Record<string, number> = {};
          for (const run of runs) if (run.cost !== null) costs[run.cost.currency] = (costs[run.cost.currency] ?? 0) + run.cost.amount;
          return [slug, { runs: runs.length, costs }] as const;
        }),
      );
      return Object.fromEntries(entries.filter(([, totals]) => totals.runs > 0));
    },

    // Waits for the appends in flight, so a read after it sees them.
    settled: () => Promise.all(queues.values()).then(() => undefined),

    remove: (slug: string) => rm(dirOf(slug), { recursive: true, force: true }),
  };
}

export type Transcripts = ReturnType<typeof createTranscripts>;
