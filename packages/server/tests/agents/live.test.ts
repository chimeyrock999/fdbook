import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '#agents/profiles.ts';
import { createAgentConversations } from '#agents/conversations.ts';
import { createTranscripts } from '#agents/transcripts.ts';
import { ended, messagesOf, waitFor } from '#tests/support/agents.ts';

// Each real agent, signed in on this machine, through the Studio: one
// read-only conversation as a reviewer, taken up again after a restart. Off by default (it costs a model call
// each and needs the logins): STUDIO_AGENT_LIVE=1 npx vitest run tests/server/agents/live.test.ts
// An agent that is not installed is skipped.
const LIVE = process.env.STUDIO_AGENT_LIVE === '1';
const NOTE = 'content/docs/live.mdx';
const TIMEOUT_MS = 240_000;

describe.skipIf(!LIVE)('real agents over ACP', () => {
  for (const profile of PROFILES) {
    it(`talks to ${profile.name} as a reviewer that only reads, over two turns and a restart`, async (context) => {
      const info = await profile.check();
      if (!info.available) context.skip();
      const root = await realpath(await mkdtemp(join(tmpdir(), 'notes-studio-live-')));
      const home = await mkdtemp(join(tmpdir(), 'notes-studio-live-home-'));
      const body = '---\ntitle: Pelican Harbor\n---\n\nA note.\n';
      await mkdir(join(root, 'content/docs'), { recursive: true });
      await writeFile(join(root, NOTE), body);
      let runs = createAgentConversations(root, { slug: 'live', profiles: [profile], transcripts: createTranscripts(home) });
      // Reject anything it asks: a reviewer needs no tool that asks.
      const answered = (id: string) => waitFor(
        {
          read: async (each) => {
            const current = await runs.read(each);
            for (const event of current.events) if (event.type === 'permission') try { runs.answer(each, event.ask.id, null, null); } catch { /* answered */ }
            return current;
          },
        },
        id,
        ended,
        TIMEOUT_MS,
      );
      try {
        const conversation = runs.start({ agent: profile.id, role: 'reviewer', by: null, prompt: `Read ${NOTE} and answer with its title only. Do not change any file.` });
        const done = await answered(conversation.id);
        expect(done.conversation.error).toBeNull();
        expect(done.conversation.status).toBe('done');
        expect(messagesOf(done.events).join('')).toMatch(/Pelican Harbor/);
        expect(await readFile(join(root, NOTE), 'utf8')).toBe(body);

        // The process stops with the Studio; the next message takes the
        // session up again, and the agent remembers, unless it can neither
        // resume nor load (a fresh session, marked).
        await runs.close();
        runs = createAgentConversations(root, { slug: 'live', profiles: [profile], transcripts: createTranscripts(home) });
        await runs.message(conversation.id, 'Which title did you answer with just before? Answer with it only, and read no file.', null);
        const again = await answered(conversation.id);
        expect(again.conversation.error).toBeNull();
        const how = again.events.flatMap((event) => (event.type === 'session' ? [event.how] : [])).at(-1);
        // Claude Code offers session/resume.
        if (profile.id === 'claude') expect(how).toBe('resumed');
        const lastTurn = again.events.map((event) => event.type).lastIndexOf('turn');
        if (how !== 'fresh') expect(messagesOf(again.events.slice(lastTurn)).join('')).toMatch(/Pelican Harbor/);
      } finally {
        await runs.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    }, TIMEOUT_MS + 10_000);
  }
});
