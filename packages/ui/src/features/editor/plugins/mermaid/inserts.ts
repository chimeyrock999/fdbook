import type { JSONContent } from '@tiptap/core';

// A Mermaid diagram is the editor's own code block, which draws it, with a
// starter indented as fumadocs' examples indent theirs.
export const mermaid: JSONContent = {
  type: 'codeBlock',
  attrs: { language: 'mermaid' },
  content: [{ type: 'text', text: 'flowchart LR\n    A[Start] --> B[End]' }],
};
