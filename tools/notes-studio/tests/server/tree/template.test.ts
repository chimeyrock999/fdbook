import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createPageTemplate, normalizePageSlug } from '../../../../../obsidian-plugin/src/services/page-creation';
import { normalizeSlug, pageTemplate } from '../../../server/tree/template';

// New pages must look the same whether the Studio or the Obsidian plugin
// made them.
describe('page template', () => {
  it('matches obsidian-plugin', () => {
    const cases: [string, string][] = [['raft', 'Raft Consensus'], ['a-b', 'Say "hi"'], ['x', '  '], ['', 'Đồng bộ dữ liệu']];
    for (const [slug, title] of cases) {
      expect(pageTemplate(slug, title)).toBe(createPageTemplate({ slug, title }));
    }
  });

  it('keeps a backslash in the title valid YAML', () => {
    const yaml = /^---\n([\s\S]*?)\n---/.exec(pageTemplate('path', 'Path C:\\data "x"'))?.[1] ?? '';
    expect(parse(yaml)).toMatchObject({ title: 'Path C:\\data "x"', graph: { displayName: 'Path C:\\data "x"' } });
  });

  it('makes slugs like obsidian-plugin', () => {
    for (const input of ['Raft Consensus', '  Ổn định  ', 'C++ & Go!', '---', 'already-a-slug']) {
      expect(normalizeSlug(input)).toBe(normalizePageSlug(input));
    }
  });
});
