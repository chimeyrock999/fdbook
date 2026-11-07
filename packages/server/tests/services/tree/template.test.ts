import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { pageTemplate } from '#services/tree/template.ts';

const frontmatter = (source: string) => /^---\n([\s\S]*?)\n---\n\n$/.exec(source)?.[1] ?? '';

// New pages carry the frontmatter fumadocs reads.
describe('page template', () => {
  it('writes a title and an empty description', () => {
    expect(pageTemplate('Raft Consensus')).toBe('---\ntitle: "Raft Consensus"\ndescription: ""\n---\n\n');
    expect(parse(frontmatter(pageTemplate('  ')))).toEqual({ title: 'Untitled', description: '' });
  });

  it('keeps quotes and backslashes in the title valid YAML', () => {
    const title = 'Path C:\\data "x"';
    expect(parse(frontmatter(pageTemplate(title)))).toEqual({ title, description: '' });
  });
});
