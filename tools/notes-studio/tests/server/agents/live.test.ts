import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../../../server/agents/profiles';
import { createAgentRuns } from '../../../server/agents/runs';
import { createTranscripts } from '../../../server/agents/transcripts';
import { ended, messagesOf, waitForRun } from '../../support/agents';

// Each real agent, signed in on this machine, through the Studio: one
// read-only prompt as a reviewer. Off by default (it costs a model call
// each and needs the logins): STUDIO_AGENT_LIVE=1 npx vitest run tests/server/agents/live.test.ts
// An agent that is not installed is skipped.
const LIVE = process.env.STUDIO_AGENT_LIVE === '1';
const NOTE = 'content/notes/live.mdx';
const TIMEOUT_MS = 240_000;

describe.skipIf(!LIVE)('real agents over ACP', () => {
  for (const profile of PROFILES) {
    it(`runs ${profile.name} as a reviewer that only reads`, async (context) => {
      const info = await profile.check();
      if (!info.available) context.skip();
      const root = await realpath(await mkdtemp(join(tmpdir(), 'notes-studio-live-')));
      const home = await mkdtemp(join(tmpdir(), 'notes-studio-live-home-'));
      const body = '---\ntitle: Pelican Harbor\n---\n\nA note.\n';
      await mkdir(join(root, 'content/notes'), { recursive: true });
      await writeFile(join(root, NOTE), body);
      const runs = createAgentRuns(root, { slug: 'live', profiles: [profile], transcripts: createTranscripts(home) });
      try {
        const run = runs.start({ agent: profile.id, role: 'reviewer', by: null, prompt: `Read ${NOTE} and answer with its title only. Do not change any file.` });
        const done = await waitForRun(
          {
            read: async (id) => {
              const current = await runs.read(id);
              // Reject anything it asks: a reviewer needs no tool that asks.
              for (const event of current.events) if (event.type === 'permission') try { runs.answer(id, event.ask.id, null, null); } catch { /* answered */ }
              return current;
            },
          },
          run.id,
          ended,
          TIMEOUT_MS,
        );
        expect(done.run.error).toBeNull();
        expect(done.run.status).toBe('done');
        expect(messagesOf(done.events).join('')).toMatch(/Pelican Harbor/);
        expect(await readFile(join(root, NOTE), 'utf8')).toBe(body);
      } finally {
        await runs.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    }, TIMEOUT_MS + 10_000);
  }
});
