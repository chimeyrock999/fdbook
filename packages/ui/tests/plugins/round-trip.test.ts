import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createSyntax, parseMdxToDoc, serializeDocToMdx, type ParsedDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { installRoot, uiRoot } from '@fdbook/server/config.ts';
import { editorConfig } from '#plugins/index.ts';

// The editor's syntax, as the registered plugins build it, over every real
// note plus each plugin's own fixtures/*.mdx: parsing and serializing an
// untouched document gives back the same bytes. A new plugin that would
// rewrite a note fails here.
type JSONContent = ParsedDoc['doc'];

const syntax = createSyntax(editorConfig.components, editorConfig.syntax);

// Relative to the repo root, so each test is named after its note.
async function documents() {
  const paths: string[] = [];
  for await (const path of glob('docs/content/docs/**/*.mdx', { cwd: installRoot })) paths.push(path);
  for await (const path of glob('src/plugins/*/fixtures/*.mdx', { cwd: uiRoot })) paths.push(relative(installRoot, join(uiRoot, path)));
  return paths.sort();
}

// One test per note: each stays well inside the default timeout however
// many notes there are, and a failure names the note.
const paths = await documents();

function find(node: JSONContent, type: string): JSONContent[] {
  const own = node.type === type ? [node] : [];
  return [...own, ...(node.content ?? []).flatMap((child) => find(child, type))];
}

describe('editor syntax', () => {
  it('finds every note and fixture', () => {
    expect(paths).toEqual(expect.arrayContaining(['docs/content/docs/index.mdx', 'docs/content/docs/guide/using.mdx']));
    expect(paths.some((path) => path.includes('/fixtures/'))).toBe(true);
  });

  it.each(paths)('round-trips %s byte for byte', async (path) => {
    const source = await readFile(join(installRoot, path), 'utf8');
    const parsed = parseMdxToDoc(source, syntax);
    expect(serializeDocToMdx(parsed.doc, parsed.snapshot, syntax)).toBe(source);
  });

  // An edited block is serialized from the document, not copied from the
  // source: a Diagram must come back with the same attributes.
  it('reads Diagram in a real note as a component and writes it back', async () => {
    const path = 'docs/content/docs/diagrams/examples.mdx';
    const source = await readFile(join(installRoot, path), 'utf8');
    const embeds = find(parseMdxToDoc(source, syntax).doc, 'Diagram');
    expect(embeds.length).toBeGreaterThan(0);
    const lines = source.split('\n').filter((line) => line.startsWith('<Diagram '));
    const written = embeds.map((embed) => serializeDocToMdx({ type: 'doc', content: [embed] }, undefined, syntax).trim());
    expect(written).toEqual(lines);
  });
});
