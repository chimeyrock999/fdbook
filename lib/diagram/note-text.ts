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
// code and no active HTML: `{expressions}` (in attributes too), `import` and
// `export`, a component it was not given, and an HTML tag outside a short
// list of text tags, or with an attribute outside a short list, are refused. Code would run at build time, a missing
// component would fail the page, and `<script>` or `<iframe>` would reach it.
// Text refused that way shows as written, in plain text: read as Markdown, a
// `<uuid>` would be dropped as an HTML tag.

export type NoteFormat = 'mdx' | 'text';

interface Attribute {
  type: string;
  name?: string;
  value?: unknown;
}

interface Tree {
  type: string;
  name?: string | null;
  attributes?: Attribute[];
  children?: Tree[];
}

const CODE = new Set(['mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm']);
const JSX = new Set(['mdxJsxFlowElement', 'mdxJsxTextElement']);
// The HTML a note may write by hand: text-level tags and simple blocks.
const TEXT_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'ul', 'var', 'wbr',
]);

// The attributes a hand-written text tag may carry, as plain strings. React
// refuses a string `style` when it renders, and `on*` handlers or a
// `javascript:` link would be active HTML.
const TEXT_ATTRIBUTES = new Set(['href', 'title', 'class', 'className', 'id', 'lang', 'dir', 'cite', 'datetime', 'dateTime', 'start', 'reversed']);

// An attribute written as `{…}`, or spread as `{...…}`.
const expressionAttribute = (attribute: Attribute) => attribute.type === 'mdxJsxExpressionAttribute'
  || (typeof attribute.value === 'object' && attribute.value !== null
    && (attribute.value as { type?: string }).type === 'mdxJsxAttributeValueExpression');

const plainTextAttribute = ({ name, value }: Attribute) => typeof name === 'string'
  && (TEXT_ATTRIBUTES.has(name) || name.startsWith('aria-'))
  && !(name === 'href' && typeof value === 'string' && /^\s*javascript:/i.test(value));

function remarkNoteOnly(components: object) {
  return () => (tree: Tree) => {
    const walk = (node: Tree) => {
      if (CODE.has(node.type)) throw new Error(`a note holds no code (${node.type})`);
      if (JSX.has(node.type)) {
        if (node.attributes?.some(expressionAttribute)) throw new Error(`a note holds no code (an attribute of ${node.name ?? 'a fragment'})`);
        // A fragment (`<>…</>`) has no name.
        const text = /^[a-z]/.test(node.name ?? '');
        if (node.name && (text ? !TEXT_TAGS.has(node.name) : !(node.name in components))) {
          throw new Error(`a note cannot draw <${node.name}>`);
        }
        if (text && !node.attributes?.every(plainTextAttribute)) throw new Error(`a note cannot set that attribute of <${node.name}>`);
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
