import type { JSONContent } from '@tiptap/core';

// What each slash-menu insert puts into the document, as the editor keeps
// it: inline JSX as text marked `mdxJsxTag`, text directives as
// `verbatimInline` atoms and block directives as `verbatim` blocks. All of
// them serialize as their source, byte for byte. A graph marker starts with
// an empty id; the Studio's graph fields open on it (src/graph). A Mermaid
// diagram is the editor's own code block, which draws it, with a starter
// indented as the notes indent theirs.

function jsxTag(text: string): JSONContent {
  return { type: 'text', text, marks: [{ type: 'mdxJsxTag', attrs: { self: false } }] };
}

function verbatim(value: string): JSONContent {
  return { type: 'verbatim', attrs: { value } };
}

export function keyword(name: 'Keyword' | 'Tag'): JSONContent[] {
  return [jsxTag(`<${name} id="" displayName="">`), { type: 'text', text: name.toLowerCase() }, jsxTag(`</${name}>`)];
}

export const graphHeading: JSONContent = {
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text: 'Title ' }, { type: 'verbatimInline', attrs: { value: ':graph-meta{id="" displayName=""}' } }],
};

export const accordions = verbatim('::::accordions{type="single"}\n:::accordion{kind="note" title="Title"}\nContent\n:::\n::::');

export const tabs = verbatim('::::tabs{items="Tab 1 | Tab 2"}\n:::tab[Tab 1]\nContent\n:::\n\n:::tab[Tab 2]\nContent\n:::\n::::');

export const steps = verbatim('::::steps\n:::step[Step 1]\nContent\n:::\n\n:::step[Step 2]\nContent\n:::\n::::');

export const youtube = verbatim('::youtube{url="" title=""}');

export const mermaid: JSONContent = {
  type: 'codeBlock',
  attrs: { language: 'mermaid' },
  content: [{ type: 'text', text: 'flowchart LR\n    A[Start] --> B[End]' }],
};
