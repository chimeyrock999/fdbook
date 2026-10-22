// A stand-in ACP agent for the tests, spoken to over stdio like the real
// ones. What it does comes from the prompt, one command per line:
//   read <path>         reads through the client and says what it read
//   write <path> <text> writes through the client
//   edit <path> <text>  writes with its own tool, reported as an edit tool call
//   sneak <path> <text> writes with its own tool, reporting nothing
//   ask                 asks for permission and says the answer
//   ask-edit            asks for permission to edit a file
//   hang                waits for a cancel
//   deaf                waits and ignores a cancel
//   crash               prints to stderr and exits
//   env                 says which of the Studio's variables it can see
//   mode                says the session's mode (it starts in acceptEdits)
//   recall              says the earlier prompts of the session, joined by |
// FAKE_AGENT=auth makes session/new ask for a sign-in; FAKE_AGENT=load
// offers session/load (it replays the history first), FAKE_AGENT=resume
// session/resume. With FAKE_AGENT_STORE, a session's prompts are kept in
// that folder, so a new process can take the session up again.
// FAKE_AGENT_MODEL=default reports a "default" model choice.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';

const sessions = new Map();
const store = process.env.FAKE_AGENT_STORE;
const way = process.env.FAKE_AGENT;
// What the process has cost so far: it adds up over its turns.
let spent = 0;
let connection;

const storeOf = (sessionId) => (store === undefined ? null : join(store, `${sessionId}.json`));
const keep = (sessionId, session) => {
  const file = storeOf(sessionId);
  if (file !== null) writeFileSync(file, JSON.stringify(session.history));
};

const sessionState = () => ({
  modes: { currentModeId: 'acceptEdits', availableModes: [{ id: 'default', name: 'Default' }, { id: 'acceptEdits', name: 'Accept edits' }] },
  configOptions: [
    process.env.FAKE_AGENT_MODEL === 'default'
      ? { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default (recommended)', description: 'Fake Two' }, { value: 'fake-1', name: 'Fake One' }] }
      : { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake-1', options: [{ value: 'fake-1', name: 'Fake One' }] },
  ],
});

// A session kept by an earlier process, back in this one.
const takeUp = (sessionId, cwd) => {
  const file = storeOf(sessionId);
  if (file === null || !existsSync(file)) throw RequestError.resourceNotFound(sessionId);
  const session = { cwd, cancelled: false, cancel: null, mode: 'acceptEdits', history: JSON.parse(readFileSync(file, 'utf8')) };
  sessions.set(sessionId, session);
  return session;
};

const say = (sessionId, text) =>
  connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

const agent = {
  async initialize() {
    const agentCapabilities = way === 'load' ? { loadSession: true } : way === 'resume' ? { sessionCapabilities: { resume: {} } } : {};
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities, agentInfo: { name: 'fake-agent', version: '1.0.0' } };
  },
  async newSession({ cwd }) {
    if (process.env.FAKE_AGENT === 'auth') throw RequestError.authRequired();
    const sessionId = `s-${randomBytes(4).toString('hex')}`;
    sessions.set(sessionId, { cwd, cancelled: false, cancel: null, mode: 'acceptEdits', history: [] });
    return { sessionId, ...sessionState() };
  },
  async loadSession({ sessionId, cwd }) {
    const session = takeUp(sessionId, cwd);
    for (const prompt of session.history) await say(sessionId, `replay:${prompt}`);
    return sessionState();
  },
  async resumeSession({ sessionId, cwd }) {
    takeUp(sessionId, cwd);
    return sessionState();
  },
  async authenticate() {
    return {};
  },
  async setSessionMode({ sessionId, modeId }) {
    sessions.get(sessionId).mode = modeId;
    return {};
  },
  async cancel({ sessionId }) {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.cancelled = true;
    session.cancel?.();
  },
  async prompt({ sessionId, prompt }) {
    const session = sessions.get(sessionId);
    const text = prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const earlier = [...session.history];
    session.history.push(text);
    keep(sessionId, session);
    session.cancelled = false;
    session.cancel = null;
    for (const line of text.split('\n')) {
      const [command, path, ...rest] = line.trim().split(' ');
      if (command === 'read') {
        try {
          const { content } = await connection.readTextFile({ sessionId, path });
          await say(sessionId, `read:${content}`);
        } catch (error) {
          await say(sessionId, `refused:${error.message}`);
        }
      } else if (command === 'write') {
        try {
          await connection.writeTextFile({ sessionId, path, content: rest.join(' ') });
          await say(sessionId, 'wrote');
        } catch (error) {
          await say(sessionId, `refused:${error.message}`);
        }
      } else if (command === 'edit' || command === 'sneak') {
        writeFileSync(path, rest.join(' '));
        if (command === 'edit') {
          await connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', toolCallId: `e-${path}`, title: `Edit ${path}`, kind: 'edit', status: 'completed', locations: [{ path }] } });
        }
      } else if (command === 'ask' || command === 'ask-edit') {
        const toolCall = command === 'ask'
          ? { toolCallId: 't1', title: 'Run npm test', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } }
          : { toolCallId: 't2', title: 'Edit a note', kind: 'edit', status: 'pending' };
        await connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', ...toolCall } });
        const answer = await connection.requestPermission({
          sessionId,
          toolCall,
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        });
        await say(sessionId, `answer:${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`);
      } else if (command === 'hang' || command === 'deaf') {
        const cancelled = command === 'hang' && session.cancelled ? true : await new Promise((resolve) => {
          if (command === 'hang') session.cancel = () => { resolve(true); };
        });
        if (cancelled) return { stopReason: 'cancelled' };
      } else if (command === 'crash') {
        process.stderr.write('boom: the fake agent crashed\n');
        process.exit(3);
      } else if (command === 'recall') {
        await say(sessionId, `recall:${earlier.join('|')}`);
      } else if (command === 'mode') {
        await say(sessionId, `mode:${session.mode}`);
      } else if (command === 'env') {
        const seen = ['STUDIO_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'FAKE_VISIBLE'].filter((name) => process.env[name] !== undefined);
        await say(sessionId, `env:${seen.join(',')} cwd:${process.cwd()}`);
      }
    }
    spent += 0.12;
    await connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: spent, currency: 'USD' } } });
    return { stopReason: 'end_turn', usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 } };
  },
};

connection = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
