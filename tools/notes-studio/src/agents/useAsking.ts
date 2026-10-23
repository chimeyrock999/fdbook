import { useEffect } from 'react';
import { firstAsk, openAsks } from './transcript';
import type { Agents } from './useAgents';

// The agents' questions waiting for someone who may answer them
// (`canAnswer`): the first one asked, whose chat the panel shows (#138: in
// the chat, no dialog over the page), and how many wait (`asks`). A new
// question opens the panel. `answering`: the chats whose agent is answering.
export function useAsking(agents: Agents, canAnswer: boolean) {
  const answering = agents.conversations.filter((conversation) => conversation.status === 'running');
  const asking = canAnswer ? firstAsk(answering, agents.events) : null;
  const asks = canAnswer ? answering.reduce((count, conversation) => count + openAsks(agents.events[conversation.id] ?? []).length, 0) : 0;
  const askId = asking?.ask.id ?? null;
  const { setPanel } = agents;
  useEffect(() => { if (askId !== null) setPanel(true); }, [askId, setPanel]);
  return { answering, asking: asking?.conversation ?? null, asks };
}
