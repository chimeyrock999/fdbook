import { evaluate } from '@mdx-js/mdx';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import type { MDXComponents } from 'mdx/types';
import { createElement, Fragment, type ReactNode } from 'react';
import * as runtime from 'react/jsx-runtime';
import remarkDirective from 'remark-directive';
import { remarkNotesDirectives } from '../remark-notes-directives.ts';

// The text of a diagram note (a node's role and points, a card's items) is
// MDX, compiled at build time as a note page is: the fumadocs preset plus the
// site's directives, drawn with the site's MDX components. A note holds no
// code, so `{expressions}` and `import`/`export` are refused, and so is a
// component the site does not have: both would compile and then fail when
// the page renders. Text that is not valid MDX that way shows as written, in
// plain text: read as Markdown, a `<uuid>` would be dropped as an HTML tag.

export type NoteFormat = 'mdx' | 'text';

interface Tree {
  type: string;
  name?: string | null;
  children?: Tree[];
}

const CODE = new Set(['mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm']);
const JSX = new Set(['mdxJsxFlowElement', 'mdxJsxTextElement']);

// Refuses code, and any JSX element that is neither an HTML tag (lower case)
// nor one of `components`.
function remarkNoteOnly(components: object) {
  return () => (tree: Tree) => {
    const walk = (node: Tree) => {
      if (CODE.has(node.type)) throw new Error(`a note holds no code (${node.type})`);
      if (JSX.has(node.type) && node.name && !/^[a-z][\w-]*$/.test(node.name) && !(node.name in components)) {
        throw new Error(`no component ${node.name}`);
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

// The site directives turn `::html` and the like into components, so the
// check runs after them. One preset per set of components (a diagram's).
const presets = new WeakMap<object, Promise<object>>();
const mdxOptions = (components: object) => {
  let options = presets.get(components);
  if (!options) {
    options = applyMdxPreset({
      remarkPlugins: [remarkDirective, remarkNotesDirectives, remarkNoteOnly(components)],
      remarkImageOptions: false,
      rehypeCodeOptions: false,
    })('runtime');
    presets.set(components, options);
  }
  return options;
};

const NO_COMPONENTS: MDXComponents = {};

// An inline text (a list item) keeps its words but not the paragraph MDX
// wraps them in.
const Unwrapped = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);

export async function renderNoteText(
  source: string,
  { components = NO_COMPONENTS, inline = false }: { components?: MDXComponents; inline?: boolean } = {},
): Promise<{ node: ReactNode; format: NoteFormat }> {
  const mapped = inline ? { ...components, p: Unwrapped } : components;
  try {
    const { default: Content } = await evaluate(source, { ...runtime, ...(await mdxOptions(components)) });
    return { node: createElement(Content, { components: mapped }), format: 'mdx' };
  } catch {
    return { node: source, format: 'text' };
  }
}
