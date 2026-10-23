import { fileURLToPath } from 'node:url';
import type { AgentConversations } from '../../server/agents/conversations';
import type { AgentProfile } from '../../server/agents/profiles';
import type { Conversation } from '../../server/agents/shared';

const FAKE_AGENT = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));

// A profile that starts the fake ACP agent (fake-agent.mjs) with `env`.
export function fakeProfile(env: Record<string, string> = {}, id: AgentProfile['id'] = 'claude', fencesReviewer = true, mode?: string): AgentProfile {
  return {
    id,
    name: 'Fake Agent',
    fencesReviewer,
    mode,
    command: () => ({ command: process.execPath, args: [FAKE_AGENT], env }),
    check: () => Promise.resolve({ available: true, reason: null, note: null, version: '1.0.0' }),
  };
}

type Read = Awaited<ReturnType<AgentConversations['read']>>;

// Waits until `test` holds for the conversation, or fails after `ms`.
export async function waitFor(conversations: Pick<AgentConversations, 'read'>, id: string, test: (read: Read) => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const read = await conversations.read(id);
    if (test(read)) return read;
    if (Date.now() > deadline) throw new Error(`conversation ${id} did not get there: ${JSON.stringify(read.conversation)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// The turn going on has ended.
export const ended = (read: { conversation: Conversation }) => read.conversation.status !== 'running';

// What the agent said, in order.
export function messagesOf(events: Read['events']) {
  return events.flatMap((event) =>
    event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk' && event.update.content.type === 'text' ? [event.update.content.text] : [],
  );
}
