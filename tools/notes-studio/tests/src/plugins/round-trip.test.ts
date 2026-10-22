import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyntax, parseMdxToDoc, serializeDocToMdx, type ParsedDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { editorConfig } from '../../../src/plugins';

// The editor's syntax, as the registered plugins build it, over every real
// note plus each plugin's own fixtures/*.mdx: parsing and serializing an
// untouched document gives back the same bytes. A new plugin that would
// rewrite a note fails here.
type JSONContent = ParsedDoc['doc'];

const syntax = createSyntax(editorConfig.components, editorConfig.syntax);
const studioRoot = join(repoRoot, 'tools/notes-studio');

async function documents() {
  const paths: string[] = [];
  for await (const path of glob('content/notes/**/*.mdx', { cwd: repoRoot })) paths.push(join(repoRoot, path));
  for await (const path of glob('src/plugins/*/fixtures/*.mdx', { cwd: studioRoot })) paths.push(join(studioRoot, path));
  return paths.sort();
}

function find(node: JSONContent, type: string): JSONContent[] {
  const own = node.type === type ? [node] : [];
  return [...own, ...(node.content ?? []).flatMap((child) => find(child, type))];
}

describe('editor syntax', () => {
  it('round-trips every note byte for byte', async () => {
    const paths = await documents();
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      const source = await readFile(path, 'utf8');
      const parsed = parseMdxToDoc(source, syntax);
      expect(serializeDocToMdx(parsed.doc, parsed.snapshot, syntax), path).toBe(source);
    }
  });

  // An edited block is serialized from the document, not copied from the
  // source: a Diagram must come back with the same attributes.
  it('reads Diagram in a real note as a component and writes it back', async () => {
    const path = 'content/notes/data-platform/stacks-integration/databricks/databricks-interactive-runtime/driver-container-first-look.mdx';
    const source = await readFile(join(repoRoot, path), 'utf8');
    const embeds = find(parseMdxToDoc(source, syntax).doc, 'Diagram');
    expect(embeds.length).toBeGreaterThan(0);
    const lines = source.split('\n').filter((line) => line.startsWith('<Diagram '));
    const written = embeds.map((embed) => serializeDocToMdx({ type: 'doc', content: [embed] }, undefined, syntax).trim());
    expect(written).toEqual(lines);
  });
});
