import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { notesMetaSchema, notesPageSchema } from '#notes-schema.ts';

const notesDir = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/content/docs');
const FRONTMATTER_REGEX = /^---\r?\n(?:([\s\S]*?)\r?\n)?---/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(notesDir);
// Every page and meta file fumadocs-mdx loads, not only the formats in use today.
const pages = files.filter((file) => /\.mdx?$/.test(file));
const metas = files.filter((file) => /(^|\/)meta\.(ya?ml|json)$/.test(file));

function readFrontmatter(file: string): unknown {
  const match = FRONTMATTER_REGEX.exec(readFileSync(file, 'utf8'));
  return (match?.[1] ? parse(match[1]) : null) ?? {};
}

describe('shared notes schema on content/docs', () => {
  it('finds the notes', () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(metas.length).toBeGreaterThan(0);
  });

  it.each(pages.map((file) => [relative(notesDir, file), file]))('accepts the frontmatter of %s', (_name, file) => {
    expect(notesPageSchema.safeParse(readFrontmatter(file)).error).toBeUndefined();
  });

  it.each(metas.map((file) => [relative(notesDir, file), file]))('accepts %s', (_name, file) => {
    expect(notesMetaSchema.safeParse(parse(readFileSync(file, 'utf8')) ?? {}).error).toBeUndefined();
  });
});

describe('shared notes schema rules', () => {
  it('requires a title', () => {
    expect(notesPageSchema.safeParse({ description: 'x' }).success).toBe(false);
  });

  it('rejects an empty graph id', () => {
    const result = notesPageSchema.safeParse({ title: 'T', graph: { id: '', displayName: 'T' } });
    expect(result.success).toBe(false);
  });

  it('rejects a keyword without displayName', () => {
    const result = notesPageSchema.safeParse({
      title: 'T',
      graph: { id: 't', displayName: 'T', keywords: [{ id: 'k' }] },
    });
    expect(result.success).toBe(false);
  });

  it('requires visible to be a boolean on pages and meta', () => {
    expect(notesPageSchema.safeParse({ title: 'T', visible: 'no' }).success).toBe(false);
    expect(notesMetaSchema.safeParse({ visible: 'no' }).success).toBe(false);
    expect(notesMetaSchema.safeParse({ title: 'Folder', pages: ['a', '...'], visible: false }).success).toBe(true);
  });
});
