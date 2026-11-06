import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadLintContext } from '#services/lint/context.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';

// A diagram that lays out, and the same file with an edge to nowhere.
const diagram = (to: string) => JSON.stringify({
  version: 1,
  title: 'Flow',
  kinds: [{ id: 'k', label: 'K', tone: 'green' }],
  nodes: [{ id: 'a', kind: 'k', label: 'A' }, { id: 'b', kind: 'k', label: 'B' }],
  edges: [{ id: 'ab', from: 'a', to }],
  layout: { nodes: { a: { x: 40, y: 100, w: 120, h: 60 }, b: { x: 400, y: 100, w: 120, h: 60 } } },
});

describe('lint context: diagrams', () => {
  let worktree: Worktree;
  const file = () => join(worktree.root, 'diagrams/guide/flow.diagram.json');

  beforeAll(async () => {
    worktree = await makeWorktree();
    await mkdir(join(worktree.root, 'diagrams/guide'), { recursive: true });
    await writeFile(file(), diagram('b'));
  });

  afterAll(async () => {
    await worktree.remove();
  });

  it('checks a diagram as the site does, and again once the file changes', async () => {
    const context = await loadLintContext(worktree.root, 'guide/intro.mdx');
    expect(context.diagramProblem('guide/flow')).toBeNull();
    expect(context.diagramProblem('guide/gone')).toBe('missing');
    expect(context.diagramProblem('../content/x')).toBe('missing');

    // The answer is kept per file, keyed on mtime and size: an edit is seen.
    await writeFile(file(), diagram('ghost'));
    const later = new Date(Date.now() + 5_000);
    await utimes(file(), later, later);
    const problem = context.diagramProblem('guide/flow');
    expect(problem).toMatchObject({ severity: 'error' });
    expect(problem === 'missing' ? '' : problem?.message).toContain('structure/unknown-endpoint');
  });
});
