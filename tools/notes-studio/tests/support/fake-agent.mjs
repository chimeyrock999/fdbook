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
// FAKE_AGENT=auth makes session/new ask for a sign-in.
import { writeFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';

const sessions = new Map();
let connection;

const say = (sessionId, text) =>
  connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

const agent = {
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: 'fake-agent', version: '1.0.0' } };
  },
  async newSession({ cwd }) {
    if (process.env.FAKE_AGENT === 'auth') throw RequestError.authRequired();
    const sessionId = `s${String(sessions.size + 1)}`;
    sessions.set(sessionId, { cwd, cancelled: false, cancel: null });
    return {
      sessionId,
      configOptions: [
        { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake-1', options: [{ value: 'fake-1', name: 'Fake One' }] },
      ],
    };
  },
  async authenticate() {
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
      } else if (command === 'env') {
        const seen = ['STUDIO_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'FAKE_VISIBLE'].filter((name) => process.env[name] !== undefined);
        await say(sessionId, `env:${seen.join(',')} cwd:${process.cwd()}`);
      }
    }
    await connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: 0.12, currency: 'USD' } } });
    return { stopReason: 'end_turn', usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 } };
  },
};

connection = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
