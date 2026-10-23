import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { atLeast } from '../auth/shared.ts';
import { createKeyedLock } from '../files/store.ts';
import { HttpError } from '../http.ts';
import type { RunGrants } from '../mcp/grants.ts';
import { classifyPath } from '../security/paths.ts';
import { RequestError } from '@agentclientprotocol/sdk';
import type { Viewer } from '../security/access.ts';
import { startAgent, type AgentProcess } from './connection.ts';
import { writeForAgent } from './fs-policy.ts';
import type { AgentProfile } from './profiles.ts';
import { PERMISSION_TIMEOUT_MS, type PermissionAsk, type RunChange, type RunEvent, type RunSummary, type StreamEvent } from './shared.ts';
import type { Transcripts } from './transcripts.ts';
import { changedSince, worktreePathOf, worktreeState } from './worktree.ts';
import { revertChange, watchRun, type RunWatch } from './watch.ts';

// Runs at once in one change request: each is a process with its own model.
export const MAX_LIVE_RUNS = 3;
const PROMPT_MAX = 20_000;
const HEARTBEAT_MS = 25_000;
// What a reviewer may still ask for; the Studio says no to anything else.
const READING_KINDS = new Set(['read', 'search', 'fetch', 'think']);
const EDIT_KINDS = new Set(['edit', 'delete', 'move']);

type Pending = { ask: PermissionAsk; resolve: (optionId: string | null) => void; timer: NodeJS.Timeout };
// `stopping`: cancelled or killed, it may still be ending; `ending`: until
// its end is recorded.
// `watch`: what the files held before the run (Keep/Revert).
type Live = { summary: RunSummary; events: RunEvent[]; pending: Map<string, Pending>; agent: AgentProcess | null; stopping: boolean; ending: Promise<void>; watch: RunWatch };

const newId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

// A text chunk the agent streams (`agent_message_chunk`, `agent_thought_chunk`).
function chunkOf(event: RunEvent) {
  if (event.type !== 'update') return null;
  const { update } = event;
  if ((update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') || update.content.type !== 'text') return null;
  return { kind: update.sessionUpdate, text: update.content.text };
}

export type AgentRunsOptions = {
  slug: string;
  profiles: AgentProfile[];
  transcripts: Transcripts;
  // The worktree's notes lock (workspace.ts): agent writes wait for renames and commits.
  lock?: ReturnType<typeof createKeyedLock>;
  // The file API's lock per file (workspace.ts), so an agent's write or a
  // revert never lands between a save's mtime check and its write.
  pathLock?: ReturnType<typeof createKeyedLock>;
  permissionTimeoutMs?: number;
  // The Studio's MCP server, given to every session with a token for the run.
  mcp?: { url: string; grants: RunGrants } | null;
  // Turns a write to a note that exists into a proposal (proposals/store.ts)
  // instead of writing it; without it the write goes to disk.
  propose?: ((input: { path: string; content: string; runId: string; agent: string; model: string | null }) => Promise<unknown>) | null;
};

// The agent runs of one change request's worktree. A run starts one agent
// process for one prompt (connection.ts); its events go to the transcript
// and to every open event stream (GET /api/agents/events). A run left
// "running" by a Studio that stopped reads as failed.
export function createAgentRuns(root: string, { slug, profiles, transcripts, lock = createKeyedLock(), pathLock = createKeyedLock(), permissionTimeoutMs = PERMISSION_TIMEOUT_MS, mcp = null, propose = null }: AgentRunsOptions) {
  const live = new Map<string, Live>();
  const streams = new Map<ServerResponse, Viewer>();
  let closed = false;

  const send = (frame: string) => {
    for (const [stream, viewer] of streams) {
      if (atLeast(viewer.current(), 'reader')) stream.write(frame);
      else {
        streams.delete(stream);
        stream.end();
      }
    }
  };
  const heartbeat = setInterval(() => { send(': heartbeat\n\n'); }, HEARTBEAT_MS);
  heartbeat.unref();

  // Every event goes to the transcript and the streams as it comes. The
  // run's events in memory, replayed to a stream that opens, join text
  // chunks of one kind in a row, so a long answer is one event there.
  const record = (run: Live, event: RunEvent) => {
    const chunk = chunkOf(event);
    const last = run.events.at(-1);
    const previous = last === undefined ? null : chunkOf(last);
    if (chunk !== null && previous !== null && previous.kind === chunk.kind) {
      run.events[run.events.length - 1] = { type: 'update', at: event.at, update: { sessionUpdate: chunk.kind, content: { type: 'text', text: previous.text + chunk.text } } };
    } else run.events.push(event);
    transcripts.append(slug, run.summary.id, event);
    const streamed: StreamEvent = { ...event, runId: run.summary.id };
    send(`data: ${JSON.stringify(streamed)}\n\n`);
  };

  const settle = (run: Live, id: string, optionId: string | null, by: string | null) => {
    const pending = run.pending.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    run.pending.delete(id);
    record(run, { type: 'answer', at: Date.now(), id, optionId, by });
    pending.resolve(optionId);
  };

  const changed = (run: Live, change: Partial<RunSummary>) => {
    run.summary = { ...run.summary, ...change };
    record(run, { type: 'summary', at: Date.now(), run: run.summary });
  };

  // Files the agent changed with its own tools: one event, and the summary.
  const touched = (run: Live, paths: string[]) => {
    const fresh = paths.filter((path) => !run.summary.writes.includes(path));
    if (fresh.length === 0) return;
    record(run, { type: 'changed', at: Date.now(), paths: fresh });
    changed(run, { writes: [...run.summary.writes, ...fresh] });
  };

  const ask = (run: Live, request: RequestPermissionRequest) =>
    new Promise<string | null>((resolve) => {
      const ask: PermissionAsk = { id: randomBytes(6).toString('hex'), toolCall: request.toolCall, options: request.options };
      if (run.stopping || run.summary.status !== 'running') {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => { settle(run, ask.id, null, null); }, permissionTimeoutMs);
      timer.unref();
      run.pending.set(ask.id, { ask, resolve, timer });
      record(run, { type: 'permission', at: Date.now(), ask });
      // A reviewer reads: whatever else it asks for (an edit, a command, an
      // escalation out of its sandbox, a tool of no kind), the Studio says no.
      if (run.summary.role === 'reviewer' && !READING_KINDS.has(request.toolCall.kind ?? '')) settle(run, ask.id, null, 'studio');
    });

  // Records the end. `before` is the worktree as the run found it: what
  // differs after, the agent's own tools changed (or a person meanwhile).
  const finish = async (run: Live, status: RunSummary['status'], error: string | null, usage: RunSummary['usage'], before: Promise<Map<string, number | null>> | null) => {
    for (const id of [...run.pending.keys()]) settle(run, id, null, null);
    if (before !== null) {
      // Committed during the run (by the agent's shell, say): clean before and after.
      const [start, end, committed] = await Promise.all([before.catch(() => null), worktreeState(root).catch(() => null), run.watch.committed()]);
      touched(run, [...new Set([...(start !== null && end !== null ? changedSince(start, end) : []), ...committed])].sort());
    }
    // What the run changed, with what each file held before, for Keep/Revert.
    if (run.summary.writes.length > 0) {
      await run.watch.settle(run.summary.writes).then((changes) => transcripts.writeChanges(slug, run.summary.id, changes)).catch(() => undefined);
    }
    run.summary = { ...run.summary, status, error, endedMs: Date.now(), usage: usage ?? run.summary.usage };
    record(run, { type: 'end', at: Date.now(), run: run.summary });
    live.delete(run.summary.id);
  };

  function start({ agent, role, prompt, by }: { agent: unknown; role: unknown; prompt: unknown; by: string | null }): RunSummary {
    if (closed) throw new HttpError(409, 'this change request is closing');
    const profile = profiles.find((candidate) => candidate.id === agent);
    if (profile === undefined) throw new HttpError(400, 'agent must be one of the Studio\'s agents');
    if (role !== 'author' && role !== 'reviewer') throw new HttpError(400, 'role must be author or reviewer');
    if (typeof prompt !== 'string' || prompt.trim() === '') throw new HttpError(400, 'prompt must be some text');
    if (prompt.length > PROMPT_MAX) throw new HttpError(413, `prompt must be at most ${String(PROMPT_MAX)} characters`);
    if (live.size >= MAX_LIVE_RUNS) throw new HttpError(409, `${String(MAX_LIVE_RUNS)} agents are already running here: wait for one or cancel it`);

    const summary: RunSummary = {
      id: newId(),
      agent: profile.id,
      agentName: profile.name,
      role,
      prompt,
      model: null,
      status: 'running',
      error: null,
      startedMs: Date.now(),
      endedMs: null,
      cost: null,
      usage: null,
      writes: [],
      by,
    };
    const before = worktreeState(root);
    before.catch(() => undefined);
    const run: Live = { summary, events: [], pending: new Map(), agent: null, stopping: false, ending: Promise.resolve(), watch: watchRun(root, before) };
    live.set(summary.id, run);
    record(run, { type: 'start', at: summary.startedMs, run: summary });
    const grant = mcp?.grants.issue({ slug, runId: summary.id, agent: profile.id, role: summary.role }) ?? null;

    try {
      run.agent = startAgent(profile, summary.role, root, prompt, {
        update: (update) => {
          record(run, { type: 'update', at: Date.now(), update });
          // An edit made with the agent's own tool, once it is done.
          if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && update.status === 'completed' && EDIT_KINDS.has(update.kind ?? '')) {
            touched(run, (update.locations ?? []).flatMap((location) => worktreePathOf(root, location.path) ?? []));
          }
        },
        model: (model) => { changed(run, { model }); },
        cost: (cost) => { changed(run, { cost }); },
        write: async (path, content) => {
          // A note that exists is never written over: the write becomes a
          // proposal, recorded when the store says it was made. A note this
          // run created itself is still its own draft (on its Keep/Revert
          // list), so it is written.
          const at = worktreePathOf(root, path);
          // The agent is told, so it does not read the note back expecting
          // its text, nor write again.
          if (propose !== null && at !== null && classifyPath(at) === 'note' && !run.watch.created(at) && existsSync(join(root, at))) {
            const made = await propose({ path: at, content, runId: run.summary.id, agent: profile.id, model: run.summary.model }).then(
              (proposal) => `the Studio made this write a proposal (${(proposal as { id: string }).id}) for a person to accept: ${at} is unchanged until then. Make further edits to it with the propose_edit tool.`,
              (error: unknown) => `the Studio takes edits to ${at} as proposals, and this one was refused: ${(error as Error).message}`,
            );
            throw RequestError.invalidParams(undefined, made);
          }
          const written = await lock('notes', () => pathLock(join(root, worktreePathOf(root, path) ?? ''), () => writeForAgent(root, path, content, (at, previous) => { run.watch.beforeWrite(at, previous); })));
          record(run, { type: 'write', at: Date.now(), path: written.path, bytes: written.bytes });
          if (!run.summary.writes.includes(written.path)) changed(run, { writes: [...run.summary.writes, written.path] });
        },
        ask: (request) => ask(run, request),
        ready: run.watch.ready,
      }, mcp === null || grant === null ? null : { url: mcp.url, token: grant.token });
    } catch (error) {
      // A profile that cannot even name its command (its package gone).
      const message = (error as Error).message;
      grant?.revoke();
      run.ending = finish(run, 'failed', message, null, null);
      return { ...run.summary, status: 'failed', error: message };
    }
    const { cancel, kill } = run.agent;
    // Pending questions are answered "cancelled", as ACP asks of a client,
    // and later ones are not asked.
    const stopping = () => {
      run.stopping = true;
      for (const id of [...run.pending.keys()]) settle(run, id, null, null);
    };
    run.agent.cancel = () => {
      stopping();
      cancel();
    };
    run.agent.kill = () => {
      stopping();
      kill();
    };
    // The run's MCP token ends with its process.
    const done = run.agent.done.finally(() => grant?.revoke());
    run.ending = done.then(
      (response) => finish(run, run.stopping || response.stopReason === 'cancelled' ? 'cancelled' : 'done', null, response.usage ?? null, before),
      (error: unknown) => finish(run, run.stopping ? 'cancelled' : 'failed', run.stopping ? null : (error as Error).message, null, before),
    );
    return run.summary;
  }

  // An ended run's changes; none while it runs.
  const storedChanges = async (id: string) => {
    if (live.has(id)) throw new HttpError(409, 'the run is still going: wait for its end');
    await transcripts.settled();
    return (await transcripts.readChanges(slug, id)) ?? [];
  };

  const liveRun = (id: string) => {
    const run = live.get(id);
    if (run === undefined) throw new HttpError(409, 'this run is not running');
    return run;
  };

  // A run as read from disk: one left running by a Studio that stopped failed.
  const ended = (run: RunSummary): RunSummary => (run.status === 'running' ? { ...run, status: 'failed', error: 'the Studio stopped during the run' } : run);

  return {
    start,

    // Ended runs are read from disk, once their last events are written.
    async list(): Promise<RunSummary[]> {
      await transcripts.settled();
      const stored = await transcripts.list(slug);
      return stored.map((run) => live.get(run.id)?.summary ?? ended(run));
    },

    async read(id: string) {
      const run = live.get(id);
      if (run !== undefined) return { run: run.summary, events: run.events };
      await transcripts.settled();
      const events = await transcripts.read(slug, id);
      const last = events === null ? undefined : [...events].reverse().find((event) => event.type === 'start' || event.type === 'summary' || event.type === 'end');
      if (events === null || last === undefined) throw new HttpError(404, `no such run: ${id}`);
      return { run: ended(last.run), events };
    },

    answer(id: string, askId: string, optionId: unknown, by: string | null) {
      const run = liveRun(id);
      const pending = run.pending.get(askId);
      if (pending === undefined) throw new HttpError(409, 'this question was already answered');
      if (optionId !== null && !pending.ask.options.some((option) => option.optionId === optionId)) {
        throw new HttpError(400, 'optionId must be one of the options asked, or null to reject');
      }
      settle(run, askId, optionId as string | null, by);
    },

    cancel(id: string) {
      liveRun(id).agent?.cancel();
    },

    // A proposal a run made (mcp/note-tools.ts, or a write above): in its transcript.
    proposed(id: string, proposal: { id: string; path: string; hunks: unknown[] }) {
      const run = live.get(id);
      if (run !== undefined) record(run, { type: 'proposal', at: Date.now(), id: proposal.id, path: proposal.path, hunks: proposal.hunks.length });
    },

    // Whether a run going on created `path` itself (mcp/note-tools.ts writes
    // to it directly instead of proposing).
    created: (id: string, path: string) => live.get(id)?.watch.created(path) ?? false,

    // The model a run going on says it runs (a proposal's author), or null.
    modelOf: (id: string) => live.get(id)?.summary.model ?? null,

    // A write a run makes through the Studio's MCP tools (mcp/http.ts):
    // what the file held, for Keep/Revert, and the file in the run's list.
    beforeWrite(id: string, path: string, previous: Buffer | null) {
      const run = live.get(id);
      if (run === undefined) return;
      run.watch.beforeWrite(path, previous);
      if (!run.summary.writes.includes(path)) changed(run, { writes: [...run.summary.writes, path] });
    },

    // A person's save through the file API: every run going on lists the
    // file as theirs to revert by hand, never to revert over their save.
    savedByPerson(path: string) {
      for (const run of live.values()) run.watch.savedByPerson(path);
    },

    // The files an ended run changed, for Keep/Revert.
    async changes(id: string): Promise<RunChange[]> {
      return (await storedChanges(id)).map(({ path, before, decided, reason }) => ({ path, existed: before !== null, decided, reason }));
    },

    // What `path` held before the run, as text (null: it did not exist).
    async before(id: string, path: string) {
      const change = (await storedChanges(id)).find((each) => each.path === path);
      if (change === undefined) throw new HttpError(404, `the run did not change ${path}`);
      return { path, content: change.before === null ? null : Buffer.from(change.before, 'base64').toString('utf8') };
    },

    // Keeps a change, or puts the file back as it was before the run. A
    // file changed again since the run ended is not reverted (409).
    decide(id: string, path: string, op: unknown) {
      if (op !== 'keep' && op !== 'revert') throw new HttpError(400, 'op must be keep or revert');
      return lock('notes', async () => {
        const changes = await storedChanges(id);
        const change = changes.find((each) => each.path === path);
        if (change === undefined) throw new HttpError(404, `the run did not change ${path}`);
        if (change.decided !== null) throw new HttpError(409, `${path} was already ${change.decided}`);
        if (op === 'revert') {
          let reverted;
          try {
            reverted = await pathLock(join(root, path), () => revertChange(root, change));
          } catch (error) {
            throw new HttpError(409, (error as Error).message);
          }
          if (!reverted) throw new HttpError(409, `${path} changed since the run ended: revert it by hand, or keep it`);
        }
        change.decided = op === 'keep' ? 'kept' : 'reverted';
        await transcripts.writeChanges(slug, id, changes);
        return { path, existed: change.before !== null, decided: change.decided, reason: change.reason } satisfies RunChange;
      });
    },

    // GET /api/agents/events: every event of every run from now on, after
    // the events so far of the runs going on.
    subscribe(response: ServerResponse, viewer: Viewer) {
      if (closed) {
        response.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'this change request is closing' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write('retry: 1000\n\n');
      for (const run of live.values()) for (const event of run.events) response.write(`data: ${JSON.stringify({ ...event, runId: run.summary.id })}\n\n`);
      streams.set(response, viewer);
      response.on('close', () => streams.delete(response));
    },

    // Stops every run and waits for their ends (a discard, the server closing).
    async close() {
      closed = true;
      clearInterval(heartbeat);
      const runs = [...live.values()];
      for (const run of runs) run.agent?.kill();
      await Promise.all(runs.map((run) => run.ending.catch(() => undefined)));
      await transcripts.settled();
      for (const stream of streams.keys()) stream.end();
      streams.clear();
    },
  };
}

export type AgentRuns = ReturnType<typeof createAgentRuns>;
