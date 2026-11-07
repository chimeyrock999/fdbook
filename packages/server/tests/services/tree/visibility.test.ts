import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { notesMetaSchema } from '@fdbook/mdx/notes-schema.ts';
import { loadTree } from '#services/tree/build.ts';
import { applyPlan, planMove, planVisibility } from '#services/tree/ops.ts';
import type { TreeFolder, TreeNode } from '@fdbook/shared/tree.ts';
import { writeMetaVisible, writePageVisible } from '#services/tree/visible-edit.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';
import { writeTreeCases } from '#tests/support/tree-cases.ts';

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
  const notes = (path: string) => join(worktree.root, 'content/docs', path);
  const text = (path: string) => readFile(notes(path), 'utf8');
  const exists = (path: string) => stat(notes(path)).then(() => true, () => false);
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

  // The docs, plus the cases they do not have (support/tree-cases.ts).
  beforeEach(async () => {
    worktree = await makeWorktree();
    await writeTreeCases(worktree.root);
  });
  afterEach(async () => {
    await worktree.remove();
  });

  it('hides a page and shows it again, leaving the file as it was', async () => {
    const path = 'reference/lint.mdx';
    const before = await text(path);
    expect(await change(path, false)).toEqual([{ type: 'change', path, detail: 'visible: false' }]);
    expect(await text(path)).toBe(before.replace(/^(title: .*\n)/m, '$1visible: false\n'));
    expect(await hiddenOf(path)).toBe('visible-false');
    expect(await change(path, true)).toEqual([{ type: 'change', path, detail: 'removes visible: false' }]);
    expect(await text(path)).toBe(before);
    expect(await hiddenOf(path)).toBeNull();
  });

  it('hides a folder in its meta.yaml, and gives a folder without one a meta.yaml', async () => {
    const meta = await text('reference/meta.yaml');
    await change('reference', false);
    expect(await text('reference/meta.yaml')).toBe(meta.replace(/^(title: .*\n)/m, '$1visible: false\n'));
    expect(await hiddenOf('reference')).toBe('visible-false');
    // Its pages stay where they were, under the hidden folder.
    expect(await hiddenOf('reference/lint.mdx')).toBeNull();

    const before = nodeAt(await loadTree(worktree.root), 'patterns') as TreeFolder;
    const order = (folder: TreeFolder) => folder.children.map((child) => `${child.kind === 'page' || child.kind === 'folder' ? child.path : child.kind} ${String(child.entry)}`);
    expect(await change('patterns', false)).toEqual([{ type: 'add', path: 'patterns/meta.yaml' }]);
    expect(await text('patterns/meta.yaml')).toBe('visible: false\npages:\n  - "caching"\n');
    const folder = nodeAt(await loadTree(worktree.root), 'patterns') as TreeFolder;
    expect([folder.hidden, folder.title, folder.defaultOpen]).toEqual(['visible-false', before.title, false]);
    // Its children keep their order and their entries, so they can still move.
    expect(order(folder)).toEqual(order(before));
    // Shown again, the folder is as it was: without meta.yaml.
    expect(await change('patterns', true)).toEqual([{ type: 'delete', path: 'patterns/meta.yaml' }]);
    expect(await exists('patterns/meta.yaml')).toBe(false);
    expect(order(nodeAt(await loadTree(worktree.root), 'patterns') as TreeFolder)).toEqual(order(before));
    // So a page added later shows by itself, as it did before.
    await writeFile(notes('patterns/later.mdx'), '---\ntitle: "Later"\n---\n');
    expect(await hiddenOf('patterns/later.mdx')).toBeNull();
  });

  it('hides a folder with only an index page in a meta.yaml the site accepts', async () => {
    // patterns has no meta.yaml, so it lists the new folder by itself.
    await mkdir(notes('patterns/retries'));
    await writeFile(notes('patterns/retries/index.mdx'), '---\ntitle: "Retries"\n---\n');
    await change('patterns/retries', false);
    const meta = await text('patterns/retries/meta.yaml');
    expect(meta).toBe('visible: false\npages: []\n');
    expect(notesMetaSchema.safeParse(parse(meta)).success).toBe(true);
    expect(await hiddenOf('patterns/retries')).toBe('visible-false');
    expect(await change('patterns/retries', true)).toEqual([{ type: 'delete', path: 'patterns/retries/meta.yaml' }]);
    expect(await exists('patterns/retries/meta.yaml')).toBe(false);
  });

  it('keeps the meta.yaml it wrote once the folder was reordered while hidden', async () => {
    await writeFile(notes('patterns/zz-later.mdx'), '---\ntitle: "Later"\n---\n');
    await change('patterns', false);
    // Pages come before folders without meta.yaml.
    expect(await text('patterns/meta.yaml')).toBe('visible: false\npages:\n  - "zz-later"\n  - "caching"\n');
    const hidden = nodeAt(await loadTree(worktree.root), 'patterns') as TreeFolder;
    await applyPlan(worktree.root, await planMove(worktree.root, await loadTree(worktree.root), { folder: 'patterns', from: 1, to: 0, baseMtime: hidden.metaMtime }));
    expect(await change('patterns', true)).toEqual([{ type: 'change', path: 'patterns/meta.yaml', detail: 'removes visible: false' }]);
    expect(await text('patterns/meta.yaml')).toBe('pages:\n  - "caching"\n  - "zz-later"\n');
  });

  it('adds an unlisted page to its folder when shown, and drops its visible: false', async () => {
    const dir = 'guide';
    const path = `${dir}/drafts.mdx`;
    const meta = await text(`${dir}/meta.yaml`);
    expect(await hiddenOf(path)).toBe('unlisted');
    expect(await change(path, true)).toEqual([
      { type: 'change', path, detail: 'removes visible: false' },
      { type: 'change', path: `${dir}/meta.yaml`, detail: 'adds "drafts"' },
    ]);
    expect(await text(`${dir}/meta.yaml`)).toBe(`${meta.replace(/\n?$/, '')}\n  - "drafts"${meta.endsWith('\n') ? '\n' : ''}`);
    expect(await hiddenOf(path)).toBeNull();
  });

  it('has no folder node to show where `...name` brings in its children', async () => {
    const meta = await text('meta.yaml');
    await writeFile(notes('meta.yaml'), meta.replace('  - "guide"\n', '  - "...archive"\n  - "guide"\n'));
    expect(await hiddenOf('archive')).toBe('gone');
  });

  it('turns a `!name` entry into the name instead of adding one', async () => {
    await writeFile(notes('reference/meta.yaml'), 'title: "R"\npages:\n  - "..."\n  - "!lint"\n');
    expect(await hiddenOf('reference/lint.mdx')).toBe('unlisted');
    expect(await change('reference/lint.mdx', true)).toEqual([
      { type: 'change', path: 'reference/meta.yaml', detail: '"!lint" becomes "lint"' },
    ]);
    expect(await text('reference/meta.yaml')).toBe('title: "R"\npages:\n  - "..."\n  - "lint"\n');
    expect(await hiddenOf('reference/lint.mdx')).toBeNull();
  });

  it('refuses to show a page whose name its folder already gives to a folder', async () => {
    // guide/ is listed; a page guide.mdx next to it is left out.
    await writeFile(notes('guide.mdx'), '---\ntitle: "G"\n---\n');
    const meta = await text('meta.yaml');
    expect(await hiddenOf('guide.mdx')).toBe('unlisted');
    const refused = change('guide.mdx', true);
    await expect(refused).rejects.toThrow('already names another page or folder');
    await expect(refused).rejects.toMatchObject({ status: 409 });
    expect(await text('meta.yaml')).toBe(meta);
  });

  it('adds an unlisted folder to the root meta.yaml', async () => {
    await change('archive', true);
    expect(await hiddenOf('archive')).toBeNull();
    expect(await text('meta.yaml')).toContain('  - "patterns"\n  - "archive"');
  });

  it('refuses the root, a missing node and a file that changed after planning', async () => {
    const tree = await loadTree(worktree.root);
    await expect(planVisibility(worktree.root, tree, { path: 'index.mdx', visible: false })).rejects.toThrow('always shown');
    await expect(planVisibility(worktree.root, tree, { path: '', visible: false })).rejects.toThrow('always shown');
    await expect(planVisibility(worktree.root, tree, { path: 'nothing.mdx', visible: false })).rejects.toThrow('no such page');
    await expect(planVisibility(worktree.root, tree, { path: 'reference', visible: 'no' })).rejects.toThrow('true or false');
    const plan = await planVisibility(worktree.root, tree, { path: 'reference', visible: false });
    await writeFile(notes('reference/meta.yaml'), 'pages: []\n');
    await expect(applyPlan(worktree.root, plan)).rejects.toMatchObject({ status: 409 });
    expect(await text('reference/meta.yaml')).toBe('pages: []\n');
  });
});
