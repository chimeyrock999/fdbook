import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { normalizeSlug, pageTemplate } from '../../../server/tree/template';

const frontmatter = (source: string) => /^---\n([\s\S]*?)\n---\n\n$/.exec(source)?.[1] ?? '';

// New pages carry the frontmatter the notes use (see rpc-and-threads.mdx).
describe('page template', () => {
  it('writes title, description and graph metadata', () => {
    expect(pageTemplate('raft', 'Raft Consensus')).toBe(
      '---\ntitle: "Raft Consensus"\ndescription: ""\ngraph:\n  id: "raft"\n  displayName: "Raft Consensus"\n  keywords: []\n  sections: []\n---\n\n',
    );
    expect(parse(frontmatter(pageTemplate('', '  ')))).toEqual({
      title: 'Untitled',
      description: '',
      graph: { id: 'untitled', displayName: 'Untitled', keywords: [], sections: [] },
    });
  });

  it('keeps quotes and backslashes in the title valid YAML', () => {
    const title = 'Path C:\\data "x"';
    expect(parse(frontmatter(pageTemplate('path', title)))).toMatchObject({ title, graph: { displayName: title } });
  });

  it('makes slugs from titles', () => {
    expect(['Raft Consensus', '  Ổn định  ', 'C++ & Go!', '---', 'already-a-slug'].map(normalizeSlug)).toEqual([
      'raft-consensus',
      'on-dinh',
      'c-go',
      '',
      'already-a-slug',
    ]);
  });
});
