import { describe, expect, it } from 'vitest';
import { usagesIn, type NoteScan } from '../../../server/assets/ops';

const DIAGRAM = 'diagrams/guide/flow.diagram.json';

describe('usagesIn', () => {
  it('finds where a note that does not parse may draw a diagram, by its src', () => {
    const lines = ['# Broken {', '', '<Diagram src="guide/flow" caption="x" />'];
    const scan: NoteScan = new Map([['content/notes/guide/broken.mdx', { mtimeMs: 1, refs: null, lines }]]);
    expect(usagesIn(scan, [DIAGRAM, 'diagrams/guide/flow-two.diagram.json']).get(DIAGRAM)).toEqual([
      { note: 'content/notes/guide/broken.mdx', line: 3, column: 15, length: 'guide/flow'.length, text: lines[2], unsure: true },
    ]);
    // `guide/flow` is not `guide/flow-two`.
    expect(usagesIn(scan, ['diagrams/guide/flow-two.diagram.json']).get('diagrams/guide/flow-two.diagram.json')).toEqual([]);
  });
});
