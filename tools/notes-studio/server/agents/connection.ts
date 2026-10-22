import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentCapabilities,
  type PromptResponse,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionModeState,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { readForAgent } from './fs-policy.ts';
import { agentEnv, type AgentProfile } from './profiles.ts';
import type { AgentRole, Cost, PermissionOption, SessionStart } from './shared.ts';

// What one agent process reports, as it goes.
export type AgentHooks = {
  update: (update: SessionUpdate) => void;
  // The model, as soon as the agent names it.
  model: (model: string) => void;
  cost: (cost: Cost) => void;
  // Writes a file through the Studio (fs-policy.ts) and records it.
  write: (path: string, content: string) => Promise<void>;
  // Resolves the option picked, or null to reject.
  ask: (request: RequestPermissionRequest) => Promise<string | null>;
};

export type AgentSession = {
  // Once the agent holds a session: which one, and how it came to it.
  ready: Promise<{ sessionId: string; how: SessionStart }>;
  // One turn: the agent's answer to `text`, in the same session as the last.
  prompt: (text: string) => Promise<PromptResponse>;
  // Asks the agent to stop its turn; stops the process if it does not.
  cancel: () => void;
  // Stops the process now.
  kill: () => void;
  // Once the process is gone: why.
  exited: Promise<string>;
};

class NotSignedIn extends Error {}

// After a cancel the agent ends its turn on its own; one that does not is stopped.
const CANCEL_GRACE_MS = 10_000;
const KILL_GRACE_MS = 2_000;
const STDERR_TAIL = 4096;
const EXIT_WAIT_MS = 500;

// The name of the model a session runs: the current value of its "model"
// config option, by its label when it has one. A "default" choice names
// the model it stands for in its description (Claude Code), or nothing.
export function modelOf(options: SessionConfigOption[] | null | undefined): string | null {
  const model = options?.find((option) => option.category === 'model' && option.type === 'select');
  if (model?.type !== 'select') return null;
  const choices = model.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
  const current = choices.find((choice) => choice.value === model.currentValue);
  if (model.currentValue === 'default') {
    const stands = current?.description?.trim() ?? '';
    return stands === '' ? null : stands;
  }
  return current?.name ?? model.currentValue;
}

// "Always" answers outlive the conversation (the agent may write them to
// its own settings), so the Studio does not offer them.
export const turnOptions = (options: PermissionOption[]) => options.filter((option) => option.kind !== 'allow_always');

// How a session is taken up again: resumed when the agent can (it replays
// nothing), else loaded (it replays the history, which the transcript
// already has), else none.
export function resumeWay(capabilities: AgentCapabilities | undefined): 'resume' | 'load' | null {
  if (capabilities?.sessionCapabilities?.resume) return 'resume';
  if (capabilities?.loadSession === true) return 'load';
  return null;
}

// Starts `profile` in `root` and opens a session: session `resume` again
// when given and the agent can, else a new one. The process stays up for
// the turns that follow (`prompt`) until it is stopped. The Studio is the
// ACP client: reads and writes go through fs-policy.ts, every permission
// request through `hooks.ask`.
export function connectAgent(profile: AgentProfile, role: AgentRole, root: string, hooks: AgentHooks, { resume = null, cancelGraceMs = CANCEL_GRACE_MS }: { resume?: string | null; cancelGraceMs?: number } = {}): AgentSession {
  const { command, args, env } = profile.command(role);
  const child = spawn(command, args, { cwd: root, env: agentEnv(process.env, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
  });

  const exited = new Promise<string>((resolve) => {
    const gone = (message: string) => {
      const tail = stderr.trim().split('\n').slice(-3).join('\n');
      resolve(tail === '' ? message : `${message}: ${tail}`);
    };
    child.once('error', (error) => { gone(`${profile.name} could not start (${error.message})`); });
    child.once('exit', (code, signal) => { gone(`${profile.name} stopped (${signal ?? `exit ${String(code)}`})`); });
  });
  const died = exited.then((message) => { throw new Error(message); });
  died.catch(() => undefined);

  // While session/load replays the history, its updates are not news.
  let replaying = false;
  const app = client({ name: 'notes-studio' })
    .onNotification(methods.client.session.update, ({ params: { update } }) => {
      if (replaying) return;
      if (update.sessionUpdate === 'config_option_update') {
        const model = modelOf(update.configOptions);
        if (model !== null) hooks.model(model);
      } else if (update.sessionUpdate === 'usage_update' && update.cost) hooks.cost({ amount: update.cost.amount, currency: update.cost.currency });
      hooks.update(update);
    })
    .onRequest(methods.client.session.requestPermission, async ({ params }) => {
      const optionId = await hooks.ask({ ...params, options: turnOptions(params.options) });
      return { outcome: optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId } };
    })
    .onRequest(methods.client.fs.readTextFile, async ({ params: { path, line, limit } }) => ({ content: await readForAgent(root, path, line, limit) }))
    .onRequest(methods.client.fs.writeTextFile, async ({ params: { path, content } }) => {
      if (role !== 'author') throw RequestError.invalidParams(undefined, 'a reviewer reads only: it cannot write files');
      await hooks.write(path, content);
      return {};
    });

  const connection = app.connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
  const agent = connection.agent;
  const meta = profile.sessionMeta?.(role) ?? null;
  let sessionId: string | null = null;
  let cancelTimer: NodeJS.Timeout | undefined;
  // The turn going on: `waiting` until its session/prompt is sent (the
  // session is still opening), `sent` until the agent answers.
  let turn: 'none' | 'waiting' | 'sent' = 'none';
  let cancelled = false;

  const signedIn = <T>(request: Promise<T>) =>
    request.catch((error: unknown) => {
      if (error instanceof RequestError && error.code === RequestError.authRequired().code) {
        throw new NotSignedIn(`${profile.name} is not signed in: sign in once in a terminal, then send again`, { cause: error });
      }
      throw error;
    });

  // The session again, or null when the agent cannot take it up.
  const again = async (id: string, way: 'resume' | 'load'): Promise<{ modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null } | null> => {
    try {
      if (way === 'resume') return await signedIn(agent.request(methods.agent.session.resume, { sessionId: id, cwd: root, mcpServers: [], _meta: meta }));
      replaying = true;
      return await signedIn(agent.request(methods.agent.session.load, { sessionId: id, cwd: root, mcpServers: [], _meta: meta }));
    } catch (error) {
      if (error instanceof NotSignedIn) throw error;
      // A session the agent no longer has (its own files gone): a fresh one.
      return null;
    } finally {
      replaying = false;
    }
  };

  const open = async () => {
    const { agentCapabilities } = await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: role === 'author' }, terminal: false },
      clientInfo: { name: 'notes-studio', version: '0' },
    });
    const way = resume === null ? null : resumeWay(agentCapabilities);
    let how: SessionStart = resume === null ? 'new' : 'fresh';
    let session = resume !== null && way !== null ? await again(resume, way) : null;
    if (session !== null && resume !== null && way !== null) {
      sessionId = resume;
      how = way === 'resume' ? 'resumed' : 'loaded';
    } else {
      const created = await signedIn(agent.request(methods.agent.session.new, { cwd: root, mcpServers: [], _meta: meta }));
      sessionId = created.sessionId;
      session = created;
    }
    const modes = session.modes?.availableModes.map((mode) => mode.id) ?? [];
    if (profile.mode !== undefined && session.modes?.currentModeId !== profile.mode && modes.includes(profile.mode)) {
      await agent.request(methods.agent.session.setMode, { sessionId, modeId: profile.mode });
    }
    const model = modelOf(session.configOptions);
    if (model !== null) hooks.model(model);
    return { sessionId, how };
  };

  // Stopped from here (cancel, kill, a failed start), not on its own.
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(cancelTimer);
    connection.close();
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, KILL_GRACE_MS).unref();
  };

  // A process that dies on its own closes the connection first: wait a
  // moment for its exit, which says why. One stopped from here gives its
  // request a moment to fail with its own reason (a sign-in asked for).
  const pause = () => new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS));
  const orDied = <T>(work: Promise<T>) =>
    Promise.race([
      work.catch(async (error: unknown) => {
        await Promise.race([died.catch(() => undefined), pause()]);
        throw error;
      }),
      died.catch(async (error: unknown) => {
        if (stopped) await pause();
        throw error;
      }),
    ]);

  const ready = orDied(open());
  ready.catch(stop);

  return {
    ready,
    prompt(text) {
      turn = 'waiting';
      cancelled = false;
      const answer = orDied(ready.then(({ sessionId: id }): Promise<PromptResponse> => {
        // Cancelled while the session opened: the message is never sent.
        if (cancelled) return Promise.resolve({ stopReason: 'cancelled' });
        turn = 'sent';
        return agent.request(methods.agent.session.prompt, { sessionId: id, prompt: [{ type: 'text', text }] });
      }));
      const settled = () => {
        turn = 'none';
        clearTimeout(cancelTimer);
      };
      void answer.then(settled, settled);
      return answer;
    },
    // Nothing to stop between turns. While the session opens, the message
    // stays unsent; once sent, the agent is asked to stop. Either way the
    // process is stopped if the turn has not ended within the grace.
    cancel() {
      if (turn === 'none') return;
      cancelled = true;
      if (turn === 'sent' && sessionId !== null) void agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined);
      clearTimeout(cancelTimer);
      cancelTimer = setTimeout(stop, cancelGraceMs);
      cancelTimer.unref();
    },
    kill: stop,
    exited,
  };
}
