import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeleteProposals, type Deleter } from '#proposals/deletes.ts';
import type { DeleteProposalView } from '@fdbook/shared/proposals.ts';

const PLAN = { changes: [], open: null, base: 'b', links: [], deleted: ['a.mdx'] };

describe('delete proposals', () => {
  let root: string;
  const by = { kind: 'run' as const, runId: 'r1', agent: 'claude', model: null };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'notes-studio-deletes-'));
    await mkdir(join(root, 'content/docs'), { recursive: true });
    await writeFile(join(root, 'content/docs/a.mdx'), '---\ntitle: A\n---\n');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const store = (deleter: Deleter = () => Promise.resolve(PLAN), onChange = vi.fn<(proposal: DeleteProposalView, proposed: boolean) => void>()) =>
    ({ deletes: createDeleteProposals(root, { dir: join(root, 'home/deletes'), deleter, onChange }), onChange });

  it('keeps one open proposal per path, even when two come at once, and tells each author it proposed', async () => {
    const { deletes, onChange } = store();
    const [one, two] = await Promise.all([
      deletes.propose({ path: 'a.mdx', by, summary: 'first' }),
      deletes.propose({ path: 'a.mdx', by: { ...by, runId: 'r2' }, summary: 'second' }),
    ]);
    expect(one.proposal.id).toBe(two.proposal.id);
    expect(await deletes.list()).toHaveLength(1);
    expect(onChange.mock.calls.map(([proposal, proposed]) => [proposal.by.kind === 'run' ? proposal.by.runId : null, proposed])).toEqual([['r1', true], ['r2', true]]);
  });

  it('settles only what is still open: a rejected proposal stays rejected', async () => {
    const { deletes } = store();
    const { proposal } = await deletes.propose({ path: 'a.mdx', by });
    await deletes.act(proposal.id, 'reject');
    await deletes.settle('a.mdx');
    expect((await deletes.read(proposal.id)).state).toBe('rejected');
  });

  it('shows a proposal whose page went another way as gone', async () => {
    const { deletes } = store();
    const { proposal } = await deletes.propose({ path: 'a.mdx', by });
    await rm(join(root, 'content/docs/a.mdx'));
    expect((await deletes.read(proposal.id)).state).toBe('gone');
  });
});
