import { fileURLToPath } from 'node:url';
import type { AgentProfile } from '../../server/agents/profiles';
import type { AgentRuns } from '../../server/agents/runs';
import type { RunSummary } from '../../server/agents/shared';

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

// Waits until `test` holds for the run, or fails after `ms`.
export async function waitForRun(runs: Pick<AgentRuns, 'read'>, id: string, test: (run: Awaited<ReturnType<AgentRuns['read']>>) => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const run = await runs.read(id);
    if (test(run)) return run;
    if (Date.now() > deadline) throw new Error(`run ${id} did not get there: ${JSON.stringify(run.run)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const ended = (run: { run: RunSummary }) => run.run.status !== 'running';

// What the agent said, in order.
export function messagesOf(events: Awaited<ReturnType<AgentRuns['read']>>['events']) {
  return events.flatMap((event) =>
    event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk' && event.update.content.type === 'text' ? [event.update.content.text] : [],
  );
}
