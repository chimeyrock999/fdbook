import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type PromptResponse,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { readForAgent } from './fs-policy.ts';
import { agentEnv, type AgentProfile } from './profiles.ts';
import type { AgentRole, Cost, PermissionOption } from './shared.ts';

// What one prompt to one agent process reports, as it goes.
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

export type AgentProcess = {
  done: Promise<PromptResponse>;
  // Asks the agent to stop its turn; stops the process if it does not.
  cancel: () => void;
  // Stops the process now.
  kill: () => void;
};

// After a cancel the agent ends its turn on its own; one that does not is stopped.
const CANCEL_GRACE_MS = 10_000;
const KILL_GRACE_MS = 2_000;
const STDERR_TAIL = 4096;
const EXIT_WAIT_MS = 500;

// The name of the model a session runs: the current value of its "model"
// config option, by its label when it has one.
export function modelOf(options: SessionConfigOption[] | null | undefined): string | null {
  const model = options?.find((option) => option.category === 'model' && option.type === 'select');
  if (model?.type !== 'select') return null;
  const choices = model.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
  return choices.find((choice) => choice.value === model.currentValue)?.name ?? model.currentValue;
}

// "Always" answers outlive the run (the agent may write them to its own
// settings), so the Studio does not offer them.
export const runOptions = (options: PermissionOption[]) => options.filter((option) => option.kind !== 'allow_always');

// Starts `profile` in `root`, opens a session and sends `prompt`. The
// Studio is the ACP client: reads and writes go through fs-policy.ts, every
// permission request through `hooks.ask`, and the process never outlives
// the prompt.
export function startAgent(profile: AgentProfile, role: AgentRole, root: string, prompt: string, hooks: AgentHooks): AgentProcess {
  const { command, args, env } = profile.command(role);
  const child = spawn(command, args, { cwd: root, env: agentEnv(process.env, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
  });

  const exited = new Promise<never>((_resolve, reject) => {
    const failed = (message: string) => {
      const tail = stderr.trim().split('\n').slice(-3).join('\n');
      reject(new Error(tail === '' ? message : `${message}: ${tail}`));
    };
    child.once('error', (error) => { failed(`${profile.name} could not start (${error.message})`); });
    child.once('exit', (code, signal) => { failed(`${profile.name} stopped (${signal ?? `exit ${String(code)}`})`); });
  });
  // Rejected only when the process goes before the prompt is answered.
  exited.catch(() => undefined);

  const app = client({ name: 'notes-studio' })
    .onNotification(methods.client.session.update, ({ params: { update } }) => {
      if (update.sessionUpdate === 'config_option_update') {
        const model = modelOf(update.configOptions);
        if (model !== null) hooks.model(model);
      } else if (update.sessionUpdate === 'usage_update' && update.cost) hooks.cost({ amount: update.cost.amount, currency: update.cost.currency });
      hooks.update(update);
    })
    .onRequest(methods.client.session.requestPermission, async ({ params }) => {
      const optionId = await hooks.ask({ ...params, options: runOptions(params.options) });
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
  let sessionId: string | null = null;
  let cancelTimer: NodeJS.Timeout | undefined;

  const talk = async () => {
    await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: role === 'author' }, terminal: false },
      clientInfo: { name: 'notes-studio', version: '0' },
    });
    let session;
    try {
      session = await agent.request(methods.agent.session.new, { cwd: root, mcpServers: [], _meta: profile.sessionMeta?.(role) ?? null });
    } catch (error) {
      if (error instanceof RequestError && error.code === RequestError.authRequired().code) {
        throw new Error(`${profile.name} is not signed in: sign in once in a terminal, then run again`, { cause: error });
      }
      throw error;
    }
    sessionId = session.sessionId;
    const modes = session.modes?.availableModes.map((mode) => mode.id) ?? [];
    if (profile.mode !== undefined && session.modes?.currentModeId !== profile.mode && modes.includes(profile.mode)) {
      await agent.request(methods.agent.session.setMode, { sessionId, modeId: profile.mode });
    }
    const model = modelOf(session.configOptions);
    if (model !== null) hooks.model(model);
    return agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: prompt }] });
  };

  const stop = () => {
    clearTimeout(cancelTimer);
    connection.close();
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, KILL_GRACE_MS).unref();
  };

  // A process that dies closes the connection first: wait a moment for its
  // exit, which says why.
  const done = Promise.race([
    talk().catch(async (error: unknown) => {
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS))]);
      throw error;
    }),
    exited,
  ]).finally(stop);
  done.catch(() => undefined);

  return {
    done,
    cancel() {
      if (sessionId !== null) void agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined);
      else stop();
      clearTimeout(cancelTimer);
      cancelTimer = setTimeout(stop, CANCEL_GRACE_MS);
      cancelTimer.unref();
    },
    kill: stop,
  };
}
