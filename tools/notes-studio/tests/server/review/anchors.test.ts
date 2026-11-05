import { describe, expect, it } from 'vitest';
import { blocksOf } from '../../../server/proposals/hunks';
import { anchorAt, likeness, locate } from '../../../server/review/anchors';
import { realNotes } from '../../support/notes';

const NOTE = `---
title: Shuffle
---

# Spark shuffle

Shuffle moves records between executors when a step needs every record of a key in one partition.

Each stage ends at a shuffle boundary. The next stage reads the files the last one wrote.

:::note
Raise spark.sql.shuffle.partitions when a partition outgrows executor memory.
:::

## Reading the Spark UI

Uneven Shuffle Read Size across tasks is a sign of skew.
`;

const blocks = (text: string) => blocksOf(text);
const at = (text: string, index: number) => anchorAt(blocks(text), index);
// Block 3 is the paragraph on stage boundaries.
const BOUNDARY = 3;

describe('locate', () => {
  it('finds the block where it was, and where it moved', () => {
    const anchor = at(NOTE, BOUNDARY);
    expect(locate(anchor, blocks(NOTE))).toBe(BOUNDARY);
    const moved = NOTE.replace('# Spark shuffle\n\n', '# Spark shuffle\n\nA new first paragraph.\n\nAnd a second.\n\n');
    expect(blocks(moved)[locate(anchor, blocks(moved)) ?? -1].text).toBe(anchor.text);
  });

  it('keeps a block edited in place, a word or the whole of it', () => {
    const anchor = at(NOTE, BOUNDARY);
    expect(locate(anchor, blocks(NOTE.replace('The next stage reads', 'The stage after it reads')))).toBe(BOUNDARY);
    // Rewritten whole: still the one block between its old neighbours.
    expect(locate(anchor, blocks(NOTE.replace(/Each stage ends.*\n/, 'Something else entirely.\n')))).toBe(BOUNDARY);
  });

  it('keeps a block edited while a neighbour changed too', () => {
    const anchor = at(NOTE, BOUNDARY);
    const both = NOTE.replace('The next stage reads', 'The stage after it reads').replace('when a step needs', 'whenever a step needs');
    expect(locate(anchor, blocks(both))).toBe(BOUNDARY);
  });

  it('follows a block through edits one after another, as the stored anchor moves', () => {
    let text = NOTE;
    let anchor = at(text, BOUNDARY);
    const steps = ['Each stage', 'Every stage', 'ends at', 'stops at', 'a shuffle boundary', 'the shuffle boundary', 'The next stage reads', 'Its successor reads', 'the last one wrote', 'its parent wrote'];
    for (let step = 0; step < steps.length; step += 2) {
      text = text.replace(steps[step], steps[step + 1]);
      const found = locate(anchor, blocks(text));
      expect(found).toBe(BOUNDARY);
      anchor = anchorAt(blocks(text), found ?? 0);
    }
    // Too far from the first text now for likeness alone to find it.
    expect(likeness(at(NOTE, BOUNDARY).text, anchor.text)).toBeLessThan(0.6);
  });

  it('is null once the block is gone, and finds it again when it comes back', () => {
    const anchor = at(NOTE, BOUNDARY);
    const gone = NOTE.replace(/Each stage ends.*\n\n/, '');
    expect(locate(anchor, blocks(gone))).toBeNull();
    expect(locate(anchor, blocks(NOTE))).toBe(BOUNDARY);
  });

  it('never takes a sibling that reads alike and was there all along', () => {
    const text = 'Good for:\n\n- reads\n\nNot good for:\n\n- writes\n';
    // "Good for:" deleted: "Not good for:" reads alike but is another block.
    expect(locate(at(text, 0), blocks('- reads\n\nNot good for:\n\n- writes\n'))).toBeNull();
    // Edited, it is found, though a sibling reads as much alike.
    expect(locate(at(text, 0), blocks('Good fit for:\n\n- reads\n\nNot good for:\n\n- writes\n'))).toBe(0);
  });

  it('keeps the copy that was edited, not its twin', () => {
    const twice = 'One.\n\nSame text.\n\nTwo.\n\nThree.\n\nSame text.\n\nFour.\n';
    expect(locate(at(twice, 1), blocks(twice.replace('Same text.\n\nTwo', 'Same text, edited.\n\nTwo')))).toBe(1);
    expect(locate(at(twice, 4), blocks(twice.replace('Same text.\n\nTwo', 'Same text, edited.\n\nTwo')))).toBe(4);
  });

  it('finds an orphaned anchor only when its block comes back word for word', () => {
    const anchor = at(NOTE, BOUNDARY);
    // Rewritten in place: a live anchor follows it, an orphaned one does not.
    const rewritten = NOTE.replace(/Each stage ends.*\n/, 'Something else entirely.\n');
    expect(locate(anchor, blocks(rewritten))).toBe(BOUNDARY);
    expect(locate(anchor, blocks(rewritten), true)).toBeNull();
    expect(locate(anchor, blocks(NOTE), true)).toBe(BOUNDARY);
  });

  it('picks the copy nearest where the block was when the text repeats', () => {
    const twice = 'One.\n\nSame.\n\nTwo.\n\nThree.\n\nSame.\n';
    expect(locate(at(twice, 1), blocks(twice))).toBe(1);
    expect(locate(at(twice, 4), blocks(twice))).toBe(4);
  });

  it('keeps the first and last blocks', () => {
    const text = 'First block here.\n\nMiddle.\n\nLast block here.\n';
    expect(locate(at(text, 0), blocks('First block, changed.\n\nMiddle.\n\nLast block here.\n'))).toBe(0);
    expect(locate(at(text, 2), blocks('First block here.\n\nMiddle.\n\nLast one, changed.\n'))).toBe(2);
  });
});

// Through the real notes and the editor's own block split.
describe('locate on every note', async () => {
  const notes = (await realNotes()).flatMap((note) => {
    try {
      return [{ ...note, blocks: blocksOf(note.source) }];
    } catch {
      return [];
    }
  });

  it('reads the notes', () => {
    expect(notes.length).toBeGreaterThan(10);
  });

  // Each edit parses the note again: up to this many blocks of each, spread out.
  const SAMPLE = 24;
  const sampled = (count: number) => [...new Set(Array.from({ length: Math.min(count, SAMPLE) }, (_each, step) => Math.floor((step * count) / Math.min(count, SAMPLE))))];

  it.each(notes.map((note) => [note.path, note] as const))('keeps blocks of %s through a word added to them', (_path, note) => {
    for (const index of sampled(note.blocks.length)) {
      const block = note.blocks[index];
      // A word before the block's last newline (inside its fence or frontmatter, if any).
      const end = block.text.trimEnd().length;
      const cut = block.text.lastIndexOf('\n', end - 1) > 0 && /^(?:```|~~~|:::|---)/.test(block.text.slice(block.text.lastIndexOf('\n', end - 1) + 1)) ? block.text.lastIndexOf('\n', end - 1) : end;
      const edited = note.source.slice(0, block.start + cut) + ' extra' + note.source.slice(block.start + cut);
      let after;
      try {
        after = blocksOf(edited);
      } catch {
        continue;
      }
      if (after.length !== note.blocks.length) continue;
      expect([index, locate(anchorAt(note.blocks, index), after)]).toEqual([index, index]);
    }
  });

  it.each(notes.map((note) => [note.path, note] as const))('takes no other block of %s for one deleted', (_path, note) => {
    const texts = note.blocks.map((each) => each.text);
    for (let index = 0; index < note.blocks.length; index += 1) {
      // A block whose text is also elsewhere is found there, rightly.
      if (texts.filter((text) => text === texts[index]).length > 1) continue;
      expect([index, locate(anchorAt(note.blocks, index), note.blocks.filter((_each, other) => other !== index))]).toEqual([index, null]);
    }
  });
});
