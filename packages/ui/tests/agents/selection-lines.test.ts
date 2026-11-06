import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockLine, blockSelection, selectionOfBlocks, sourceSelection } from '#agents/editor-place.ts';
import { mentionAt } from '#agents/context-labels.ts';
import { blocksOf } from '@fdbook/shared/hunks.ts';
import { realNotes } from '@fdbook/testing/notes.ts';

const TEXT = '---\ntitle: First look\n---\n\nA first look.\n\nTwo\nlines here.\n\n- one\n- two\n';
const DOC = Text.of(TEXT.split('\n'));

// The lines `source` claims to be, as the note has them.
const linesOf = (text: string, [first, last]: [number, number]) => text.split('\n').slice(first - 1, last).join('\n');

describe('selection lines', () => {
  it('takes whole lines in Source, with the text selected in them', () => {
    const from = TEXT.indexOf('first');
    expect(sourceSelection(DOC, from, TEXT.indexOf('here'))).toEqual({ lines: [5, 8], source: 'A first look.\n\nTwo\nlines here.', text: 'first look.\n\nTwo\nlines ' });
    // A selection up to the start of a line ends on the line before.
    expect(sourceSelection(DOC, TEXT.indexOf('Two'), TEXT.indexOf('- one')).lines).toEqual([7, 9]);
  });

  it('takes the lines of the blocks a Visual selection touches, the frontmatter as block 0', () => {
    expect(blockSelection(TEXT, 2, 2, 'lines')).toEqual({ lines: [7, 8], source: 'Two\nlines here.', text: 'lines' });
    expect(blockSelection(TEXT, 0, 1, '')?.lines).toEqual([1, 5]);
    expect(blockSelection(TEXT, 3, 3, '')?.source).toBe('- one\n- two');
    expect(blockSelection(TEXT, 2, 9, '')).toBeNull();
    expect(blockSelection('<Broken', 0, 0, '')).toBeNull();
    expect(blockLine(TEXT, 1)).toBe(5);
    expect(blockLine(TEXT, 9)).toBeNull();
  });

  it('names the right lines for every block of every note', async () => {
    for (const { path, source } of await realNotes()) {
      const blocks = blocksOf(source);
      for (let index = 0; index < blocks.length; index += 1) {
        const selection = selectionOfBlocks(source, blocks, index, index, '');
        expect(selection, `${path} block ${String(index)}`).not.toBeNull();
        if (selection === null) continue;
        expect(linesOf(source, selection.lines), `${path} block ${String(index)}`).toBe(selection.source);
        expect(selection.source.trim(), `${path} block ${String(index)}`).toBe(blocks[index].text.trim());
      }
    }
  });
});


describe('mentions being typed', () => {
  it('finds the @word at the caret, after a space or at the start', () => {
    expect(mentionAt('see @gui', 8)).toEqual({ start: 4, text: 'gui' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, text: '' });
    expect(mentionAt('mail a@b', 8)).toBeNull();
    expect(mentionAt('see @guide now', 14)).toBeNull();
  });
});
