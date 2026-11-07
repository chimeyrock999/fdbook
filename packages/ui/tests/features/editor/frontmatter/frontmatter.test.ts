import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsRoot } from '@fdbook/testing/notes.ts';
import { frontmatterPathAt, readFrontmatter, writeFrontmatter } from '#features/editor/frontmatter/frontmatter.ts';

const note = `---
# shown in the sidebar
title: 'Spark execution model'
description: "From code to tasks"
icon: Cpu
graph:
  id: spark
  displayName: Spark
  keywords:
    - id: lineage # RDD side
      displayName: Lineage
---

## Body <GraphMeta id="body" displayName="Body" />

Text.
`;

describe('readFrontmatter', () => {
  it('reads the fields and keeps the source span', () => {
    const read = readFrontmatter(note);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.data.title).toBe('Spark execution model');
    expect(read.data.graph?.keywords).toEqual([{ id: 'lineage', displayName: 'Lineage' }]);
    expect(read.issues).toEqual([]);
  });

  it('reports a missing block, broken YAML and schema issues', () => {
    expect(readFrontmatter('# no frontmatter\n').status).toBe('missing');
    const broken = readFrontmatter('---\ntitle: [unclosed\n---\n');
    expect(broken.status).toBe('invalid');
    const wrong = readFrontmatter('---\ntitle: X\nvisible: maybe\n---\n');
    expect(wrong.status).toBe('ok');
    if (wrong.status === 'ok') expect(wrong.issues.map((issue) => issue.path)).toEqual(['visible']);
  });

  it('reads CRLF and an empty block', () => {
    const crlf = readFrontmatter('---\r\ntitle: X\r\n---\r\nbody\r\n');
    expect(crlf.status === 'ok' && crlf.data.title).toBe('X');
    const empty = readFrontmatter('---\n---\nbody\n');
    expect(empty.status).toBe('ok');
    if (empty.status === 'ok') expect(empty.issues.map((issue) => issue.path)).toEqual(['title']);
  });
});

describe('writeFrontmatter', () => {
  const edit = (source: string, change: (data: Record<string, unknown>) => Record<string, unknown>) => {
    const read = readFrontmatter(source);
    if (read.status !== 'ok') throw new Error(read.status);
    return writeFrontmatter(source, change({ ...read.data }));
  };

  it('changes only the edited value and keeps comments, quotes, order and other keys', () => {
    const result = edit(note, (data) => ({ ...data, title: 'Spark execution' }));
    expect(result.issues).toEqual([]);
    expect(result.source).toBe(note.replace("title: 'Spark execution model'", "title: 'Spark execution'"));
  });

  it('leaves the source byte-identical when nothing changed', () => {
    expect(edit(note, (data) => data).source).toBe(note);
  });

  it('adds and removes keys, keywords and sections', () => {
    const result = edit(note, (data) => ({
      ...data,
      description: undefined,
      visible: false,
      graph: {
        id: 'spark',
        displayName: 'Spark',
        keywords: [
          { id: 'lineage', displayName: 'Lineage' },
          { id: 'dag', displayName: 'DAG' },
        ],
        sections: [{ id: 'body', displayName: 'Body' }],
      },
    }));
    expect(result.issues).toEqual([]);
    expect(result.source).toContain('    - id: lineage # RDD side\n');
    expect(result.source).not.toContain('description');
    const read = readFrontmatter(result.source);
    expect(read.status === 'ok' && read.data).toEqual({
      title: 'Spark execution model',
      icon: 'Cpu',
      visible: false,
      graph: {
        id: 'spark',
        displayName: 'Spark',
        keywords: [
          { id: 'lineage', displayName: 'Lineage' },
          { id: 'dag', displayName: 'DAG' },
        ],
        sections: [{ id: 'body', displayName: 'Body' }],
      },
    });
    expect(result.source.endsWith('---\n\n## Body <GraphMeta id="body" displayName="Body" />\n\nText.\n')).toBe(true);
  });

  it('writes nothing when the result breaks the schema', () => {
    const result = edit(note, (data) => ({ ...data, visible: 'yes', graph: { id: '', displayName: 'Spark' } }));
    expect(result.source).toBe(note);
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['graph.id', 'visible']);
  });

  it('writes an empty flow list that gains entries as a block list', () => {
    const source = '---\ntitle: X\ngraph:\n  id: x\n  displayName: X\n  keywords: []\n---\n';
    const result = edit(source, (data) => ({ ...data, graph: { id: 'x', displayName: 'X', keywords: [{ id: 'a', displayName: 'A' }] } }));
    expect(result.source).toBe('---\ntitle: X\ngraph:\n  id: x\n  displayName: X\n  keywords:\n    - id: a\n      displayName: A\n---\n');
  });

  it('matches keys that YAML does not read as strings', () => {
    const source = '---\ntitle: X\n2024: archived\ntrue: yes\n---\n';
    const result = edit(source, (data) => ({ ...data, title: 'Y' }));
    expect(result.source).toBe('---\ntitle: Y\n2024: archived\ntrue: yes\n---\n');
    expect(edit(source, (data) => ({ ...data, 2024: undefined })).source).toBe('---\ntitle: X\ntrue: yes\n---\n');
  });

  it('creates the block when the note has none', () => {
    const result = writeFrontmatter('# Body\n', { title: 'New' });
    expect(result.source).toBe('---\ntitle: New\n---\n\n# Body\n');
  });

  it('creates the block with the note\'s own line endings', () => {
    expect(writeFrontmatter('# Body\r\n', { title: 'New' }).source).toBe('---\r\ntitle: New\r\n---\r\n\r\n# Body\r\n');
  });

  it('keeps CRLF line endings', () => {
    const source = '---\r\ntitle: X\r\n---\r\nbody\r\n';
    expect(edit(source, (data) => ({ ...data, title: 'Y' })).source).toBe('---\r\ntitle: Y\r\n---\r\nbody\r\n');
  });

  // Every real note reads with no schema issue, and a no-op write is byte-identical.
  it('round-trips every note in content/docs', async () => {
    const { glob } = await import('node:fs/promises');
    const seen: string[] = [];
    for await (const path of glob('content/docs/**/*.mdx', { cwd: docsRoot })) {
      const source = await readFile(join(docsRoot, path), 'utf8');
      const read = readFrontmatter(source);
      expect(read.status, path).toBe('ok');
      if (read.status !== 'ok') continue;
      expect(read.issues, path).toEqual([]);
      expect(writeFrontmatter(source, read.data).source, path).toBe(source);
      // A new title moves the title line and nothing else.
      const retitled = writeFrontmatter(source, { ...read.data, title: 'Retitled' }).source.split('\n');
      const changed = source.split('\n').filter((line, index) => line !== retitled[index]);
      expect(changed, path).toEqual([expect.stringMatching(/^title:/)]);
      seen.push(path);
    }
    // A top-level page and one in a folder: the glob reaches both.
    expect(seen).toEqual(expect.arrayContaining(['content/docs/index.mdx', 'content/docs/guide/using.mdx']));
  });
});

describe('frontmatterPathAt', () => {
  const at = (needle: string, source = note) => frontmatterPathAt(source, source.indexOf(needle));

  it('names the value under an offset as the schema names paths', () => {
    expect(at("'Spark execution model'")).toBe('title');
    expect(at('Cpu')).toBe('icon');
    expect(at('id: spark')).toBe('graph.id');
    expect(at('lineage')).toBe('graph.keywords.0.id');
    expect(at('Lineage')).toBe('graph.keywords.0.displayName');
  });

  // An mdx-parse issue without a position comes back at offset 0.
  it('is empty on a comment, and null on the fences or outside the block', () => {
    expect(at('# shown')).toBe('');
    expect(frontmatterPathAt(note, 0)).toBeNull();
    expect(frontmatterPathAt(note, note.indexOf('---\n\n## Body'))).toBeNull();
    expect(at('## Body')).toBeNull();
    expect(frontmatterPathAt('# no frontmatter\n', 0)).toBeNull();
  });

  it('follows CRLF and broken YAML', () => {
    const crlf = '---\r\ntitle: X\r\ngraph:\r\n  id: x\r\n---\r\n';
    expect(frontmatterPathAt(crlf, crlf.indexOf('x\r\n---'))).toBe('graph.id');
    expect(frontmatterPathAt('---\ntitle: [x\n---\n', 5)).toBeNull();
  });
});
