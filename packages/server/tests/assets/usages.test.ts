import { describe, expect, it } from 'vitest';
import { usagesIn, type NoteScan } from '#assets/ops.ts';

const DIAGRAM = 'diagrams/guide/flow.diagram.json';

describe('usagesIn', () => {
  it('finds where a note that does not parse may draw a diagram, by its src', () => {
    const lines = ['# Broken {', '', '<Diagram src="guide/flow" caption="x" />'];
    const scan: NoteScan = new Map([['content/docs/guide/broken.mdx', { mtimeMs: 1, refs: null, lines }]]);
    expect(usagesIn(scan, [DIAGRAM, 'diagrams/guide/flow-two.diagram.json']).get(DIAGRAM)).toEqual([
      { note: 'content/docs/guide/broken.mdx', line: 3, column: 15, length: 'guide/flow'.length, text: lines[2], unsure: true },
    ]);
    // `guide/flow` is not `guide/flow-two`, and neither is `other/guide/flow` or `guide/flow/deep`.
    expect(usagesIn(scan, ['diagrams/guide/flow-two.diagram.json']).get('diagrams/guide/flow-two.diagram.json')).toEqual([]);
    const elsewhere: NoteScan = new Map([['content/docs/guide/broken.mdx', { mtimeMs: 1, refs: null, lines: ['# Broken {', '<Diagram src="other/guide/flow" />', '<Diagram src="guide/flow/deep" />'] }]]);
    expect(usagesIn(elsewhere, [DIAGRAM]).get(DIAGRAM)).toEqual([]);
    // A leading `/` is the same src.
    const rooted: NoteScan = new Map([['content/docs/guide/broken.mdx', { mtimeMs: 1, refs: null, lines: ['# Broken {', '<Diagram src="/guide/flow" />'] }]]);
    expect(usagesIn(rooted, [DIAGRAM]).get(DIAGRAM)?.map((usage) => usage.line)).toEqual([2]);
  });
});
