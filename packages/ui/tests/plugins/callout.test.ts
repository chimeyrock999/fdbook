import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMdxToDoc, serializeDocToMdx, type ParsedDoc } from '@fumadocs-editor/core';
import { componentTypeName } from '@fumadocs-editor/core/extensions';
import { describe, expect, it } from 'vitest';
import { editorConfig } from '#plugins/index.ts';
import { CALLOUT_TYPES, DIRECTIVE_TYPES } from '#plugins/callout/types.ts';
import { defined, syntax } from '#tests/support/editor-state.ts';
import { uiRoot } from '@fdbook/server/config.ts';
import { realNotes } from '@fdbook/testing/notes.ts';

// The docs write only `:::note`; the plugin's fixture has every site name.
const FIXTURE = 'src/plugins/callout/fixtures/callouts.mdx';
const notes = [...await realNotes(), { path: FIXTURE, source: await readFile(join(uiRoot, FIXTURE), 'utf8') }];

type JSONContent = ParsedDoc['doc'];

const directive = defined(editorConfig.components.find((spec) => spec.name === ':::'));
const DIRECTIVE = componentTypeName(directive);

function walk(node: JSONContent, visit: (node: JSONContent) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function typeOf(node: JSONContent) {
  const attributes = (node.attrs?.attributes ?? []) as { name: string; value: unknown }[];
  return attributes.find((attribute) => attribute.name === 'type')?.value;
}

describe('callout directives', () => {
  it('reads every site callout name as a callout', () => {
    expect(DIRECTIVE_TYPES).toEqual(['note', 'info', 'tip', 'example', 'success', 'warn', 'warning', 'caution', 'important', 'danger', 'error']);
    for (const name of DIRECTIVE_TYPES) {
      const node = defined(parseMdxToDoc(`:::${name}[Title]\nBody.\n:::\n`, syntax).doc.content?.[0]);
      expect(node.type, name).toBe(DIRECTIVE);
      expect(typeOf(node), name).toBe(name);
    }
  });

  // The site's own names in the real notes and the fixture: before this
  // plugin `:::example` and `:::caution` stayed source. Two kinds still do, by the editor's own
  // rules: a callout holding an accordion group (not an admonition, so the
  // editor bails) and one whose title has formatting (the title region is
  // plain text).
  // One test per note, each well inside the default timeout; the last one
  // checks the totals (tests in a file run in order).
  describe('in the real notes', () => {
    const types: Record<string, number> = {};

    it.each(notes)('turns the callouts in $path into components', ({ source }) => {
      walk(parseMdxToDoc(source, syntax).doc, (node) => {
        if (node.type === DIRECTIVE) {
          const type = String(typeOf(node));
          types[type] = (types[type] ?? 0) + 1;
        }
        if (node.type !== 'verbatim') return;
        const value = String(node.attrs?.value);
        const name = /^:{3,}([\w-]+)/.exec(value)?.[1];
        if (name && DIRECTIVE_TYPES.includes(name)) expect(value).toMatch(/:{3,}accordion|^:{3,}[\w-]+\[(?![^`*_:<[\]\n]*\])/);
      });
    });

    it('finds the site names among them', () => {
      // One `:::note` from the docs (configuration.mdx), one from the fixture.
      expect(types.note).toBeGreaterThanOrEqual(2);
      expect(types.example).toBeGreaterThanOrEqual(1);
      expect(types.caution).toBeGreaterThanOrEqual(1);
    });
  });

  it('writes an edited title and type back as the directive', () => {
    const { doc } = parseMdxToDoc(':::example[Old]\nBody.\n:::\n', syntax);
    const node = defined(doc.content?.[0]);
    defined(node.content?.[0]).content = [{ type: 'text', text: 'New' }];
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe(':::example[New]\nBody.\n:::\n');
    node.attrs = { ...node.attrs, attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: 'caution' }, { type: 'mdxJsxAttribute', name: 'title', value: 'New' }] };
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe(':::caution[New]\nBody.\n:::\n');
  });

  it('offers the site types in the props panel', () => {
    const callout = defined(editorConfig.components.find((spec) => spec.name === 'Callout'));
    expect(callout.props?.find((prop) => prop.name === 'type')?.options).toEqual(CALLOUT_TYPES);
    expect(directive.props?.find((prop) => prop.name === 'type')?.options).toEqual(DIRECTIVE_TYPES);
  });
});
