import type { AgentConversations } from '#services/agents/chat/conversations.ts';
import type { ChangeRequests } from '#services/cr/manager.ts';

export type HandoffRequest = { name: string; brief: string };
export type HandoffResult = { slug: string; name: string; branch: string; url: string; conversationId: string };

// create_cr for an agent on main (http.ts): opens a change request
// and starts an author chat there with the same agent, for the person who
// sent the message, the brief as its first message. The chat on main
// records it (a `handoff` event) and the agent gets the link. One per
// message: an agent cannot open change requests in a loop.
export function createHandoff({ crs, main, open, link }: {
  crs: Pick<ChangeRequests, 'create'>;
  main: Pick<AgentConversations, 'turnOf' | 'handedOff'>;
  // A change request's conversations, once its workspace is open.
  open: (slug: string) => Promise<Pick<AgentConversations, 'start'> | null>;
  // Where a person opens that chat (null: the change request alone).
  link: (slug: string, conversationId: string | null) => string;
}) {
  const claimed = new Set<string>();
  return async (runId: string, { name, brief }: HandoffRequest): Promise<HandoffResult> => {
    const turn = main.turnOf(runId);
    if (turn === null) throw new Error('create_cr works only while the chat answers a message');
    const key = `${runId}@${String(turn.index)}`;
    if (claimed.has(key)) throw new Error('this message already opened a change request: one per message');
    claimed.add(key);
    let cr;
    try {
      cr = await crs.create(name);
    } catch (error) {
      claimed.delete(key);
      throw error;
    }
    // The change request stays opened (and this message's claim taken)
    // when its chat cannot start: the chat on main still links it.
    let conversationId: string | null = null;
    let failed: string | null = null;
    try {
      const conversations = await open(cr.slug);
      if (conversations === null) failed = 'agents cannot work there';
      else conversationId = conversations.start({ agent: turn.agent, role: 'author', prompt: brief, by: turn.by, from: runId }).id;
    } catch (error) {
      failed = (error as Error).message;
    }
    const url = link(cr.slug, conversationId);
    main.handedOff(runId, { slug: cr.slug, name: cr.name, branch: cr.branch, url, chat: conversationId });
    if (failed !== null) throw new Error(`the change request ${cr.slug} was opened (${url}), but its author chat could not start: ${failed}. Tell the person to open it and start a chat there.`);
    return { slug: cr.slug, name: cr.name, branch: cr.branch, url, conversationId: conversationId ?? '' };
  };
}

export type Handoff = ReturnType<typeof createHandoff>;
