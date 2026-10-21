import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTree } from '../../../server/tree/build';
import { applyPlan, planVisibility } from '../../../server/tree/ops';
import type { TreeFolder, TreeNode } from '../../../server/tree/types';
import { writeMetaVisible, writePageVisible } from '../../../server/tree/visible-edit';
import { makeWorktree, type Worktree } from '../../support/studio';

describe('visible: false in a page or meta.yaml', () => {
  const page = '---\ntitle: "A"\ndescription: ""\n---\n\nBody\n---\n';

  it('hides a page under its title and shows it again byte for byte', () => {
    const hidden = writePageVisible(page, false);
    expect(hidden).toBe('---\ntitle: "A"\nvisible: false\ndescription: ""\n---\n\nBody\n---\n');
    expect(writePageVisible(hidden, true)).toBe(page);
    const crlf = page.replace(/\n/g, '\r\n');
    expect(writePageVisible(writePageVisible(crlf, false), true)).toBe(crlf);
    expect(writePageVisible('---\n---\nBody', false)).toBe('---\nvisible: false\n---\nBody');
    expect(writePageVisible('---\nvisible: false\n---\nBody', true)).toBe('---\n---\nBody');
  });

  it('changes nothing that already says so, or a visible: true when showing', () => {
    expect(writePageVisible(page, true)).toBe(page);
    const shown = '---\ntitle: A\nvisible: true\n---\n';
    expect(writePageVisible(shown, true)).toBe(shown);
    expect(writePageVisible(shown, false)).toBe('---\ntitle: A\nvisible: false\n---\n');
    expect(writeMetaVisible('title: X\nvisible: false\n', false)).toBe('title: X\nvisible: false\n');
    expect(writeMetaVisible('visible: false\n', true)).toBe('visible: true\n');
  });

  it('keeps comments and key order in meta.yaml', () => {
    const meta = 'title: "X" # name\n# order\ndefaultOpen: false\npages:\n  - a\n';
    const hidden = writeMetaVisible(meta, false);
    expect(hidden).toBe('title: "X" # name\nvisible: false\n# order\ndefaultOpen: false\npages:\n  - a\n');
    expect(writeMetaVisible(hidden, true)).toBe(meta);
  });

  it('refuses a page without frontmatter or with YAML it cannot read', () => {
    expect(() => writePageVisible('# Title\n', false)).toThrow('no frontmatter');
    expect(() => writePageVisible('---\ntitle: [\n---\n', true)).toThrow('frontmatter does not parse');
    expect(() => writePageVisible('---\ntitle: [\n---\n', false)).toThrow('frontmatter does not parse');
  });
});

describe('hiding and showing from the page tree', () => {
  let worktree: Worktree;
  const notes = (path: string) => join(worktree.root, 'content/notes', path);
  const text = (path: string) => readFile(notes(path), 'utf8');
  const change = async (path: string, visible: boolean) => {
    const plan = await planVisibility(worktree.root, await loadTree(worktree.root), { path, visible });
    await applyPlan(worktree.root, plan);
    return plan.changes;
  };
  const nodeAt = (folder: TreeFolder, path: string): TreeNode | undefined => {
    for (const child of folder.children) {
      if ((child.kind === 'page' || child.kind === 'folder') && child.path === path) return child;
      if (child.kind === 'folder') {
        const found = nodeAt(child, path);
        if (found) return found;
      }
    }
    return undefined;
  };
  const hiddenOf = async (path: string) => {
    const node = nodeAt(await loadTree(worktree.root), path);
    return node && 'hidden' in node ? node.hidden : 'gone';
  };

  beforeEach(async () => {
    worktree = await makeWorktree();
  });
  afterEach(async () => {
    await worktree.remove();
  });

  it('hides a page and shows it again, leaving the file as it was', async () => {
    const path = 'distributed-systems/rpc-and-threads.mdx';
    const before = await text(path);
    expect(await change(path, false)).toEqual([{ type: 'change', path, detail: 'visible: false' }]);
    expect(await text(path)).toBe(before.replace(/^(title: .*\n)/m, '$1visible: false\n'));
    expect(await hiddenOf(path)).toBe('visible-false');
    expect(await change(path, true)).toEqual([{ type: 'change', path, detail: 'removes visible: false' }]);
    expect(await text(path)).toBe(before);
    expect(await hiddenOf(path)).toBeNull();
  });

  it('hides a folder in its meta.yaml, and gives a folder without one a meta.yaml', async () => {
    const meta = await text('distributed-systems/meta.yaml');
    await change('distributed-systems', false);
    expect(await text('distributed-systems/meta.yaml')).toBe(meta.replace(/^(title: .*\n)/m, '$1visible: false\n'));
    expect(await hiddenOf('distributed-systems')).toBe('visible-false');
    // Its pages stay where they were, under the hidden folder.
    expect(await hiddenOf('distributed-systems/rpc-and-threads.mdx')).toBeNull();

    const title = (nodeAt(await loadTree(worktree.root), 'data-modeling') as TreeFolder).title;
    expect(await change('data-modeling', false)).toEqual([{ type: 'add', path: 'data-modeling/meta.yaml' }]);
    expect(await text('data-modeling/meta.yaml')).toBe('visible: false\n');
    const folder = nodeAt(await loadTree(worktree.root), 'data-modeling') as TreeFolder;
    expect([folder.hidden, folder.title, folder.defaultOpen]).toEqual(['visible-false', title, false]);
    // Shown again: an empty meta.yaml would fail the site's schema.
    await change('data-modeling', true);
    expect(await text('data-modeling/meta.yaml')).toBe('visible: true\n');
    expect(await hiddenOf('data-modeling')).toBeNull();
  });

  it('adds an unlisted page to its folder when shown, and drops its visible: false', async () => {
    const dir = 'data-platform/stacks-integration/databricks/databricks-interactive-runtime';
    const path = `${dir}/command-execution-path.mdx`;
    const meta = await text(`${dir}/meta.yaml`);
    expect(await hiddenOf(path)).toBe('unlisted');
    expect(await change(path, true)).toEqual([
      { type: 'change', path, detail: 'removes visible: false' },
      { type: 'change', path: `${dir}/meta.yaml`, detail: 'adds "command-execution-path"' },
    ]);
    expect(await text(`${dir}/meta.yaml`)).toBe(`${meta.replace(/\n?$/, '')}\n  - "command-execution-path"${meta.endsWith('\n') ? '\n' : ''}`);
    expect(await hiddenOf(path)).toBeNull();
  });

  it('adds an unlisted folder to the root meta.yaml', async () => {
    await change('database', true);
    expect(await hiddenOf('database')).toBeNull();
    expect(await text('meta.yaml')).toContain('  - "personal-reflections"\n  - "database"');
  });

  it('refuses the root, a missing node and a file that changed after planning', async () => {
    const tree = await loadTree(worktree.root);
    await expect(planVisibility(worktree.root, tree, { path: 'index.mdx', visible: false })).rejects.toThrow('always shown');
    await expect(planVisibility(worktree.root, tree, { path: '', visible: false })).rejects.toThrow('always shown');
    await expect(planVisibility(worktree.root, tree, { path: 'nothing.mdx', visible: false })).rejects.toThrow('no such page');
    await expect(planVisibility(worktree.root, tree, { path: 'distributed-systems', visible: 'no' })).rejects.toThrow('true or false');
    const plan = await planVisibility(worktree.root, tree, { path: 'distributed-systems', visible: false });
    await writeFile(notes('distributed-systems/meta.yaml'), 'pages: []\n');
    await expect(applyPlan(worktree.root, plan)).rejects.toMatchObject({ status: 409 });
    expect(await text('distributed-systems/meta.yaml')).toBe('pages: []\n');
  });
});
