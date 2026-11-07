import { parseMdxToDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { applyAt, blocksOf, hunksOf, NOTE_SYNTAX, placeOf, rebased, type HunkText } from '@fdbook/shared/hunks.ts';
import { findBlock } from '@fdbook/shared/frontmatter-block.ts';
import { editorConfig, editorSyntax } from '@fdbook/ui/plugins/index.ts';
import { realNotes } from '@fdbook/testing/notes.ts';

const NOTE = '---\ntitle: A\n---\n\n# One\n\nFirst paragraph.\n\nSecond paragraph.\n\n- a\n- b\n\nLast one.\n';

// `source` with every hunk applied where it is now; fails when one is stale.
function applyAll(source: string, hunks: HunkText[]) {
  const blocks = blocksOf(source);
  return applyAt(source, hunks.map((hunk) => {
    const place = placeOf(hunk, source, blocks);
    if (place === null) throw new Error(`stale: ${JSON.stringify(hunk)}`);
    return { place, added: hunk.added };
  }));
}

describe('blocksOf', () => {
  it('parses with the dialects the editor plugins turn on', () => {
    expect(NOTE_SYNTAX).toEqual(editorConfig.syntax);
  });

  it('splits every real note where the editor does, the frontmatter first', async () => {
    for (const { path, source } of await realNotes()) {
      const front = findBlock(source);
      const body = source.slice(front?.end ?? 0);
      const editor = parseMdxToDoc(body, editorSyntax()).snapshot.blocks.map((block) => block.source);
      const blocks = blocksOf(source);
      expect(blocks.map((block) => block.text), path).toEqual([...(front ? [source.slice(0, front.end)] : []), ...editor]);
      for (const block of blocks) expect(source.slice(block.start, block.end), path).toBe(block.text);
    }
  });
});

describe('hunksOf', () => {
  it('finds no hunk in an unchanged note', () => {
    expect(hunksOf(NOTE, NOTE)).toEqual([]);
  });

  it('makes one hunk of a changed paragraph, anchored on its neighbours', () => {
    const next = NOTE.replace('First paragraph.', 'First paragraph, rewritten.');
    expect(hunksOf(NOTE, next)).toEqual([
      { before: '# One', after: 'Second paragraph.', removed: '\n\nFirst paragraph.\n\n', added: '\n\nFirst paragraph, rewritten.\n\n', count: 1, index: 1 },
    ]);
  });

  it('keeps changes apart when an unchanged block is between them', () => {
    const next = NOTE.replace('# One', '# Uno').replace('Last one.', 'Last one, changed.');
    const hunks = hunksOf(NOTE, next);
    expect(hunks).toHaveLength(2);
    expect(applyAll(NOTE, hunks)).toBe(next);
  });

  it('covers added and removed blocks, the frontmatter and spacing', () => {
    const cases = [
      NOTE.replace('Second paragraph.\n\n', 'Second paragraph.\n\nA new one.\n\n'),
      NOTE.replace('Second paragraph.\n\n', ''),
      NOTE.replace('title: A', 'title: B\ndescription: Short'),
      NOTE.replace('Second paragraph.\n\n', 'Second paragraph.\n\n\n'),
      NOTE.replace(/\n$/, ''),
      `Intro.\n\n${NOTE.slice(findBlock(NOTE)?.end ?? 0)}`,
      '',
    ];
    for (const next of cases) {
      const hunks = hunksOf(NOTE, next);
      expect(hunks.length, next).toBeGreaterThan(0);
      expect(applyAll(NOTE, hunks), next).toBe(next);
    }
  });

  // Through real notes: one block changed is one hunk, and applying it
  // gives exactly the text the agent sent.
  it('turns one changed block of every real note into one hunk that applies byte for byte', async () => {
    for (const { path, source } of await realNotes()) {
      const blocks = blocksOf(source);
      const target = [...blocks].reverse().find((block) => /^[A-Za-zÀ-ỹ]/.test(block.text));
      if (target === undefined) continue;
      const next = `${source.slice(0, target.end)} Edited.${source.slice(target.end)}`;
      const hunks = hunksOf(source, next);
      expect(hunks, path).toHaveLength(1);
      expect(applyAll(source, hunks), path).toBe(next);
    }
  });
});

describe('placeOf and rebased', () => {
  const next = NOTE.replace('Second paragraph.', 'Second paragraph, by the agent.');
  const [hunk] = hunksOf(NOTE, next);

  it('still finds a hunk when another block changed', () => {
    const now = NOTE.replace('# One', '# One, by a person').replace('Last one.', 'Last one and more.');
    expect(applyAll(now, [hunk])).toBe(now.replace('Second paragraph.', 'Second paragraph, by the agent.'));
  });

  it('still finds a hunk whose neighbours both changed', () => {
    const now = NOTE.replace('First paragraph.', 'First, by a person.').replace('- a\n- b', '- c');
    expect(applyAll(now, [hunk])).toBe(now.replace('Second paragraph.', 'Second paragraph, by the agent.'));
  });

  it('places an insertion by one anchor, never by none', () => {
    const [insert] = hunksOf(NOTE, NOTE.replace('Second paragraph.\n\n', 'Second paragraph.\n\nNew.\n\n'));
    expect(insert.count).toBe(0);
    const now = NOTE.replace('- a\n- b', '- c');
    expect(applyAll(now, [insert])).toBe(now.replace('Second paragraph.\n\n', 'Second paragraph.\n\nNew.\n\n'));
    const bare = NOTE.replace('Second paragraph.', 'Two.').replace('- a\n- b', '- c');
    expect(placeOf(insert, bare, blocksOf(bare))).toBeNull();
  });

  it('is stale once its own block changed, and rebases onto what is there now', () => {
    const now = NOTE.replace('Second paragraph.', 'Second paragraph, by a person.');
    expect(placeOf(hunk, now, blocksOf(now))).toBeNull();
    const moved = rebased(hunk, now, blocksOf(now));
    if (moved === null) throw new Error('did not rebase');
    expect(moved.removed).toBe('\n\nSecond paragraph, by a person.\n\n');
    expect(applyAll(now, [moved])).toBe(next);
  });

  it('cannot rebase once an anchor is gone', () => {
    const now = NOTE.replace('First paragraph.', 'Changed first.').replace('Second paragraph.', 'Changed second.');
    expect(placeOf(hunk, now, blocksOf(now))).toBeNull();
    expect(rebased(hunk, now, blocksOf(now))).toBeNull();
  });

  it('picks the nearest place when the anchors repeat', () => {
    const twice = 'A.\n\nB.\n\nC.\n\nA.\n\nB.\n\nC.\n';
    const [second] = hunksOf(twice, 'A.\n\nB.\n\nC.\n\nA.\n\nB, changed.\n\nC.\n');
    expect(second.index).toBe(3);
    expect(applyAll(twice, [second])).toBe('A.\n\nB.\n\nC.\n\nA.\n\nB, changed.\n\nC.\n');
  });
});
