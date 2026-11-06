import { describe, expect, it } from 'vitest';
import { insertEntry, keepEntries, metaTemplate, moveEntry, quote, readPages, removeKey, replaceEntry, setDefaultOpen, setFlag } from '#services/tree/meta-edit.ts';

// A meta.yaml as people write them by hand: quoted entries, a commented-out
// entry above the list and no newline at the end of the file.
const HAND_WRITTEN = 'title: "Data Platform"\nicon: TreePine\ndefaultOpen: true\npages:\n  # - "processing"\n  - "stacks-integration"\n  - "data-quality"';

describe('meta.yaml edits', () => {
  it('moves an entry and keeps comments, quotes and the missing final newline', () => {
    // A commented-out entry above the list, no newline at the end of the file.
    const text = HAND_WRITTEN;
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
    const text = HAND_WRITTEN;
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
    // An empty value with a comment after it: the comment stays a comment.
    expect(setDefaultOpen('title: X\ndefaultOpen: # c\npages: []\n', true)).toBe('title: X\ndefaultOpen: true # c\npages: []\n');
    expect(setDefaultOpen('defaultOpen:   # c\n', true)).toBe('defaultOpen: true   # c\n');
    expect(readPages(setDefaultOpen('defaultOpen: # c\npages: [a]\n', true))).toEqual(['a']);
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

  it('sets any flag like defaultOpen and takes it out again byte for byte', () => {
    for (const text of ['title: X # name\nicon: Brain\npages: []\n', 'title: X', 'pages:\n  - a\n', '', 'title: X\r\npages: []\r\n', 'title: |\n  Long\npages: []\n']) {
      const hidden = setFlag(text, 'visible', false);
      expect(hidden).toBe(setDefaultOpen(text, false).replace('defaultOpen', 'visible'));
      expect(removeKey(hidden, 'visible')).toBe(text);
    }
    expect(setFlag('title: X\nvisible: true # shown\n', 'visible', false)).toBe('title: X\nvisible: false # shown\n');
  });

  it('removes a key with its comment and leaves a file without it alone', () => {
    expect(removeKey('title: X\nvisible: false # off\npages: []\n', 'visible')).toBe('title: X\npages: []\n');
    expect(removeKey('visible:\ntitle: X\n', 'visible')).toBe('title: X\n');
    expect(removeKey('title: X\n', 'visible')).toBe('title: X\n');
    expect(removeKey('', 'visible')).toBe('');
    expect(() => removeKey('visible:\n  a: b\n', 'visible')).toThrow('visible is not a value');
    expect(() => removeKey('{ visible: false }\n', 'visible')).toThrow('not a block map');
    expect(() => setFlag('title: [\n', 'visible', false, 'frontmatter')).toThrow('frontmatter does not parse');
  });

  it('keeps only the entries asked for, with every other line as it was', () => {
    const block = 'title: X # the shelf\npages:\n  - "one" # first\n  # a note\n  - "two"\n  - "---Later---"\nicon: Book\n';
    expect(keepEntries(block, (value) => value !== 'two')).toBe('title: X # the shelf\npages:\n  - "one" # first\n  # a note\n  - "---Later---"\nicon: Book\n');
    expect(keepEntries('pages:\n  - a\n  - b', (value) => value === 'a')).toBe('pages:\n  - a');
    expect(keepEntries('pages: [a, "b", c]\n', (value) => value !== 'b')).toBe('pages: [a, c]\n');
    expect(keepEntries('title: X\npages:\n  - a\n', () => false)).toBe('title: X\npages: []\n');
    expect(keepEntries('title: X\n', () => false)).toBe('title: X\n');
    expect(readPages(keepEntries('pages: [a, b]\n', () => false))).toEqual([]);
  });
});
