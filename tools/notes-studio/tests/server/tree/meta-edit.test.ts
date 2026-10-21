import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { insertEntry, metaTemplate, moveEntry, quote, readPages, replaceEntry, setDefaultOpen } from '../../../server/tree/meta-edit';

const real = (path: string) => readFileSync(join(repoRoot, 'content/notes', path), 'utf8');

describe('meta.yaml edits', () => {
  it('moves an entry and keeps comments, quotes and the missing final newline', () => {
    // A commented-out entry above the list, no newline at the end of the file.
    const text = real('data-platform/meta.yaml');
    expect(text.endsWith('\n')).toBe(false);
    const moved = moveEntry(text, 1, 0);
    expect(moved).toBe(text.replace('  - "stacks-integration"\n  - "data-quality"', '  - "data-quality"\n  - "stacks-integration"'));
    expect(readPages(moved)).toEqual(['data-quality', 'stacks-integration']);
    expect(moveEntry(moved, 0, 1)).toBe(text);
  });

  it('leaves comment lines and blank lines where they are', () => {
    const text = [
      'title: "Databricks"',
      'visible: true',
      'pages:',
      '  # - "spark-foundation"',
      '  - "a" # first',
      '',
      '  # - "03-identity-and-run-as"',
      "  - 'b'",
      '  - c',
      '',
    ].join('\n');
    expect(moveEntry(text, 0, 2)).toBe(
      ['title: "Databricks"', 'visible: true', 'pages:', '  # - "spark-foundation"', "  - 'b'", '', '  # - "03-identity-and-run-as"', '  - c', '  - "a" # first', ''].join('\n'),
    );
  });

  it('inserts like the entry next to it', () => {
    const text = 'title: X\npages:\n  - "a"\n  - "b"';
    expect(insertEntry(text, 'new', 1)).toBe('title: X\npages:\n  - "a"\n  - "new"\n  - "b"');
    expect(insertEntry(text, 'new', 2)).toBe('title: X\npages:\n  - "a"\n  - "b"\n  - "new"');
    expect(insertEntry('pages:\n- a\n- b\n', 'new', 0)).toBe('pages:\n- new\n- a\n- b\n');
    expect(insertEntry("pages:\n  - 'a'\n", "it's", 1)).toBe("pages:\n  - 'a'\n  - 'it''s'\n");
  });

  it('turns an empty list into a block list and leaves a file without pages alone', () => {
    expect(insertEntry('title: "X"\ndefaultOpen: true\npages: []\n', 'a', 0)).toBe('title: "X"\ndefaultOpen: true\npages:\n  - "a"\n');
    expect(insertEntry('pages: [a, "b"]\n', 'c', 2)).toBe('pages: [a, "b", "c"]\n');
    expect(insertEntry('pages: [a, "b"]\n', 'c', 0)).toBe('pages: [c, a, "b"]\n');
    expect(insertEntry('title: X\n', 'a', 0)).toBeNull();
    expect(readPages('title: X\n')).toBeNull();
  });

  it('moves entries of a flow list in place', () => {
    expect(moveEntry('pages: [a, "b", c]\n', 2, 0)).toBe('pages: [c, a, "b"]\n');
  });

  it('replaces a value in its own quote style', () => {
    const text = 'pages:\n  - "a"\n  - \'b\'\n  - c # note\n  - "!d"\n';
    expect(replaceEntry(text, 0, 'x')).toBe('pages:\n  - "x"\n  - \'b\'\n  - c # note\n  - "!d"\n');
    expect(replaceEntry(text, 1, 'x')).toBe('pages:\n  - "a"\n  - \'x\'\n  - c # note\n  - "!d"\n');
    expect(replaceEntry(text, 2, 'x/y')).toBe('pages:\n  - "a"\n  - \'b\'\n  - x/y # note\n  - "!d"\n');
    expect(replaceEntry(text, 3, '!e')).toBe('pages:\n  - "a"\n  - \'b\'\n  - c # note\n  - "!e"\n');
  });

  it('quotes a plain value that would not read back as itself', () => {
    expect(quote('a-b', 'PLAIN')).toBe('a-b');
    expect(quote('!a', 'PLAIN')).toBe('"!a"');
    expect(quote('true', 'PLAIN')).toBe('"true"');
    expect(quote('a: b', 'PLAIN')).toBe('"a: b"');
  });

  it('refuses entries that are out of range or a file that does not parse', () => {
    expect(() => moveEntry('pages:\n  - a\n', 0, 3)).toThrow('no such entry');
    expect(() => moveEntry('title: X\n', 0, 0)).toThrow('no pages list');
    expect(() => moveEntry('pages: [a\n', 0, 0)).toThrow('does not parse');
  });

  it('writes the meta.yaml of a new folder, closed unless asked', () => {
    expect(metaTemplate('Raft "Consensus"', [])).toBe('title: "Raft \\"Consensus\\""\ndefaultOpen: false\npages: []\n');
    expect(metaTemplate('Notes', ['a', 'b'], true)).toBe('title: "Notes"\ndefaultOpen: true\npages:\n  - "a"\n  - "b"\n');
  });

  it('sets defaultOpen in place and keeps the rest of the file', () => {
    // No final newline, a commented-out entry.
    const text = real('data-platform/meta.yaml');
    expect(setDefaultOpen(text, false)).toBe(text.replace('defaultOpen: true', 'defaultOpen: false'));
    expect(setDefaultOpen(text, true)).toBe(text);
    expect(setDefaultOpen('title: X\ndefaultOpen: no # site\npages: []\n', true)).toBe('title: X\ndefaultOpen: true # site\npages: []\n');
  });

  it('adds defaultOpen after the title, or first when there is none', () => {
    expect(setDefaultOpen('title: X # name\nicon: Brain\npages: []\n', true)).toBe('title: X # name\ndefaultOpen: true\nicon: Brain\npages: []\n');
    expect(setDefaultOpen('title: X', true)).toBe('title: X\ndefaultOpen: true');
    expect(setDefaultOpen('pages:\n  - a\n', true)).toBe('defaultOpen: true\npages:\n  - a\n');
    expect(setDefaultOpen('', true)).toBe('defaultOpen: true\n');
  });

  it('keeps comments where they are, an empty value a pair, and CRLF line ends', () => {
    expect(setDefaultOpen('title: X\n\n# the order\npages: []\n', false)).toBe('title: X\ndefaultOpen: false\n\n# the order\npages: []\n');
    expect(setDefaultOpen('title: X\ndefaultOpen:\npages: []\n', false)).toBe('title: X\ndefaultOpen: false\npages: []\n');
    expect(setDefaultOpen('title: X\r\npages: []\r\n', true)).toBe('title: X\r\ndefaultOpen: true\r\npages: []\r\n');
    expect(setDefaultOpen('title: X\r\n', true)).toBe('title: X\r\ndefaultOpen: true\r\n');
    // A block title: the line goes before the next key.
    expect(setDefaultOpen('title: |\n  Long\n  name\npages: []\n', true)).toBe('title: |\n  Long\n  name\ndefaultOpen: true\npages: []\n');
  });

  it('refuses a meta.yaml it cannot edit by line', () => {
    expect(() => setDefaultOpen('pages: [a\n', true)).toThrow('does not parse');
    expect(() => setDefaultOpen('{ title: X }\n', true)).toThrow('not a block map');
    expect(() => setDefaultOpen('- a\n', true)).toThrow('not a block map');
  });
});
