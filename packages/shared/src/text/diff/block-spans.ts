import { parseMdxToDoc, type Syntax } from '@fumadocs-editor/core';

// The top-level blocks of a note's body as the editor splits them: each
// block's text and where it starts and ends in `body`. Throws when the body
// does not parse. Shared with the server (text/hunks.ts).
export function blockSpans(body: string, syntax: Syntax): { text: string; start: number; end: number }[] {
  const { snapshot } = parseMdxToDoc(body, syntax);
  let at = snapshot.leading.length;
  return snapshot.blocks.map((block, index) => {
    const span = { text: block.source, start: at, end: at + block.source.length };
    at = span.end + (snapshot.gaps[index]?.length ?? 0);
    return span;
  });
}
