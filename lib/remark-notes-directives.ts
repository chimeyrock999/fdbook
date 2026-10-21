import type { PhrasingContent, Root } from 'mdast';
import { CALLOUT_DIRECTIVES } from './notes-syntax.ts';

type Position = NonNullable<Root['position']>;
type Point = Position['start'];

type DirectiveNode = {
  type: string;
  name?: string;
  attributes?: Record<string, unknown>;
  children?: unknown[];
  data?: Record<string, unknown>;
  position?: Position;
};

type DirectiveType = 'containerDirective' | 'leafDirective' | 'textDirective';

type SourceFile = { value?: unknown };

type PositionedNode = { position?: Partial<Position> };

const calloutDirectiveTypes = new Set<string>(CALLOUT_DIRECTIVES);

const directiveFences: Record<DirectiveType, string> = {
  containerDirective: ':::',
  leafDirective: '::',
  textDirective: ':',
};

export function remarkNotesDirectives() {
  return (tree: Root, file?: SourceFile) => {
    const source = typeof file?.value === 'string' ? file.value : undefined;

    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;

      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) visit(child);

        // Each child has been through its transform above, so a child that is still a
        // directive is one the site does not render: remark-directive read it out of
        // plain text (`10:01`, `localhost:3000`) or its name is mistyped. Turn it back
        // into the text that was written instead of rendering an empty element.
        if (node.children.some(isDirective)) {
          node.children = node.children.flatMap((child: unknown) =>
            isDirective(child) ? restoreUnknownDirective(child, source) : [child],
          );
        }
      }

      if (!('type' in node) || typeof node.type !== 'string') return;

      if (node.type === 'containerDirective') {
        transformContainerDirective(node as DirectiveNode);
        return;
      }

      if (node.type === 'leafDirective') {
        transformLeafDirective(node as DirectiveNode);
        return;
      }

      if (node.type === 'textDirective') {
        transformTextDirective(node as DirectiveNode);
      }
    };

    visit(tree);
  };
}

function isDirective(node: unknown): node is DirectiveNode & { type: DirectiveType } {
  return (
    !!node &&
    typeof node === 'object' &&
    'type' in node &&
    typeof node.type === 'string' &&
    Object.hasOwn(directiveFences, node.type)
  );
}

/**
 * Turns an unknown directive back into what the author wrote. A text directive becomes
 * inline text, a leaf directive a paragraph, and a container directive a paragraph for
 * each fence around its (still rendered) body. Label children stay as nodes so any
 * formatting inside `[...]` keeps rendering.
 */
function restoreUnknownDirective(node: DirectiveNode & { type: DirectiveType }, source: string | undefined): unknown[] {
  const children = Array.isArray(node.children) ? node.children : [];

  if (node.type === 'textDirective') return restoreDirectiveHead(node, children, source);

  if (node.type === 'leafDirective') return [createParagraph(restoreDirectiveHead(node, children, source))];

  const labelIndex = children.findIndex(isDirectiveLabel);
  const label = labelIndex >= 0 ? children[labelIndex] : undefined;
  const labelChildren = label && Array.isArray((label as DirectiveNode).children) ? (label as DirectiveNode).children! : [];
  const body = children.filter((_, index) => index !== labelIndex);
  const closingFence = getClosingFence(node, source);

  return [
    createParagraph(restoreDirectiveHead(node, labelChildren, source)),
    ...body,
    ...(closingFence ? [createParagraph([createText(closingFence.fence, closingFence.position)])] : []),
  ];
}

/**
 * Rebuilds `:name[label]{attributes}` (with the directive's own number of colons).
 * The text comes from the original source when the node's position is known, so the
 * attributes keep their exact spelling; otherwise it is rebuilt from the node.
 */
function restoreDirectiveHead(node: DirectiveNode & { type: DirectiveType }, labelChildren: unknown[], source: string | undefined) {
  const fence = directiveFences[node.type];
  const start = node.position?.start;
  const end = node.position?.end;
  let head = source !== undefined && start?.offset !== undefined && end?.offset !== undefined
    ? source.slice(start.offset, end.offset)
    : undefined;

  // A container's position spans its body and closing fence; its head is the first line.
  if (head !== undefined && node.type === 'containerDirective') head = head.split(/\r?\n/)[0];

  if (head !== undefined && start && head.replace(/^:+/, '').startsWith(node.name ?? '') && head.startsWith(fence)) {
    const headEnd = start.offset! + head.length;
    const headEndPoint: Point =
      node.type === 'containerDirective'
        ? { line: start.line, column: start.column + head.length, offset: headEnd }
        : end!;
    const first = (labelChildren[0] as PositionedNode | undefined)?.position?.start;
    const last = (labelChildren.at(-1) as PositionedNode | undefined)?.position?.end;

    if (!labelChildren.length) return [createText(head, { start, end: headEndPoint })];

    if (
      first?.offset !== undefined &&
      last?.offset !== undefined &&
      first.offset >= start.offset! &&
      last.offset <= headEnd
    ) {
      return [
        createText(source!.slice(start.offset, first.offset), { start, end: first as Point }),
        ...labelChildren,
        createText(source!.slice(last.offset, headEnd), { start: last as Point, end: headEndPoint }),
      ];
    }
  }

  const attributes = formatDirectiveAttributes(node.attributes ?? {});

  if (!labelChildren.length) return [createText(`${fence}${node.name ?? ''}${attributes}`)];

  return [createText(`${fence}${node.name ?? ''}[`), ...labelChildren, createText(`]${attributes}`)];
}

function getClosingFence(node: DirectiveNode, source: string | undefined): { fence: string; position?: Position } | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end;

  if (source === undefined || start === undefined || end?.offset === undefined) return { fence: ':::' };

  const lines = source.slice(start, end.offset).split(/\r?\n/);
  const openingLength = lines[0].match(/^:*/)![0].length;
  // The last line may sit behind a blockquote marker or list indentation (`> :::`).
  const lastLine = lines.length > 1 ? lines.at(-1)! : '';
  const closing = lines.length > 1 ? lastLine.match(/^[\s>]*(:{3,})\s*$/)?.[1] : undefined;

  // An unclosed container runs to the end of the document and has no closing fence of
  // its own; a shorter fence on its last line belongs to a nested container.
  if (!closing || closing.length < openingLength) return undefined;

  const column = lastLine.indexOf(closing) + 1;
  const offset = end.offset - lastLine.length + column - 1;
  return {
    fence: closing,
    position: {
      start: { line: end.line, column, offset },
      end: { line: end.line, column: column + closing.length, offset: offset + closing.length },
    },
  };
}

function formatDirectiveAttributes(attributes: Record<string, unknown>) {
  const entries = Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) return '';

  const formatted = entries.map(([name, value]) => {
    const text = String(value);
    if (text === '') return name;
    // Prefer the quote the value does not contain, so the text reads as written.
    if (text.includes('"') && !text.includes("'")) return `${name}='${text}'`;
    return `${name}="${text.replaceAll('"', '&quot;')}"`;
  });

  return `{${formatted.join(' ')}}`;
}

function isDirectiveLabel(node: unknown) {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as DirectiveNode).type === 'paragraph' &&
    (node as DirectiveNode).data?.directiveLabel === true
  );
}

function createText(value: string, position?: Position) {
  return position ? { type: 'text', value, position } : { type: 'text', value };
}

/**
 * A paragraph spanning its children. fumadocs' remarkStructure (the search index) slices
 * each paragraph from the authored source by its position and skips one without.
 */
function createParagraph(children: unknown[]) {
  const start = (children[0] as PositionedNode | undefined)?.position?.start;
  const end = (children.at(-1) as PositionedNode | undefined)?.position?.end;

  return start && end ? { type: 'paragraph', children, position: { start, end } } : { type: 'paragraph', children };
}

function transformContainerDirective(node: DirectiveNode) {
  if (!node.name || !Array.isArray(node.children)) return;

  if (calloutDirectiveTypes.has(node.name)) {
    const { children, title } = extractDirectiveLabel(node.children);

    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Callout',
      attributes: [
        createMdxAttribute('type', node.name),
        ...(title ? [createMdxAttribute('title', title)] : []),
      ],
      children,
    });

    return;
  }

  if (node.name === 'accordion') {
    const { children, title } = extractDirectiveLabel(node.children);
    const attributes = node.attributes ?? {};
    const accordionTitle = getStringAttribute(attributes, 'title') ?? title ?? 'Accordion';

    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Accordions',
      attributes: [createMdxAttribute('type', getStringAttribute(attributes, 'type') ?? 'single')],
      children: [
        {
          type: 'mdxJsxFlowElement',
          name: 'Accordion',
          attributes: [
            createMdxAttribute('title', accordionTitle),
            ...createStringAttributes(attributes, ['id', 'kind', 'value']),
          ],
          children,
        },
      ],
    });

    return;
  }

  if (node.name === 'accordions') {
    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Accordions',
      attributes: createStringAttributes(node.attributes ?? {}, ['type', 'defaultValue']),
    });

    return;
  }

  if (node.name === 'tabs') {
    const attributes = node.attributes ?? {};
    const items = getStringAttribute(attributes, 'items');

    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Tabs',
      attributes: [
        ...(items ? [createMdxAttribute('items', items)] : []),
        ...createStringAttributes(attributes, ['label', 'defaultIndex', 'defaultValue']),
      ],
    });

    return;
  }

  if (node.name === 'tab') {
    const { children, title } = extractDirectiveLabel(node.children);
    const attributes = node.attributes ?? {};
    const value = getStringAttribute(attributes, 'value') ?? title;

    if (!value) return;

    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Tab',
      attributes: [
        createMdxAttribute('value', value),
        ...createStringAttributes(attributes, ['displayName', 'graphKind', 'graphType']),
      ],
      children,
    });

    return;
  }

  if (node.name === 'steps') {
    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Steps',
      attributes: [],
    });

    return;
  }

  if (node.name === 'step') {
    const { children, title } = extractDirectiveLabel(node.children);

    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'Step',
      attributes: [],
      children: title ? [createStrongParagraph(title), ...children] : children,
    });
  }
}

function transformLeafDirective(node: DirectiveNode) {
  if (!node.name) return;

  if (node.name === 'youtube') {
    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'YouTube',
      attributes: createStringAttributes(node.attributes ?? {}, ['url', 'title']),
      children: [],
    });

    return;
  }

  if (node.name === 'html') {
    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'HtmlEmbed',
      attributes: createStringAttributes(node.attributes ?? {}, [
        'src',
        'title',
        'caption',
        'height',
        'isolate',
        'sandbox',
        'className',
      ]),
      children: [],
    });

    return;
  }

  if (node.name === 'svg' || node.name === 'diagram') {
    Object.assign(node, {
      type: 'mdxJsxFlowElement',
      name: 'SvgDiagram',
      attributes: createStringAttributes(node.attributes ?? {}, [
        'src',
        'label',
        'caption',
        'maxWidth',
        'invertOnDark',
        'plate',
        'zoom',
        'className',
      ]),
      children: [],
    });
  }
}

function transformTextDirective(node: DirectiveNode) {
  if (!node.name) return;

  if (node.name === 'graph-meta') {
    Object.assign(node, {
      type: 'mdxJsxTextElement',
      name: 'graph-meta',
      attributes: createStringAttributes(node.attributes ?? {}, ['id', 'displayName', 'displayname', 'graphKind', 'graphType']),
      children: [],
    });

    return;
  }

  if (node.name === 'keyword' || node.name === 'tag') {
    const attributes = node.attributes ?? {};
    const children = Array.isArray(node.children) ? node.children : [];
    const label = phrasingContentToText(children as PhrasingContent[]);
    const displayName = getStringAttribute(attributes, 'displayName') ?? getStringAttribute(attributes, 'displayname') ?? label;

    Object.assign(node, {
      type: 'mdxJsxTextElement',
      name: node.name === 'keyword' ? 'Keyword' : 'Tag',
      attributes: [
        ...createStringAttributes(attributes, ['id']),
        createMdxAttribute('displayName', displayName),
      ],
      children,
    });
  }
}

function extractDirectiveLabel(children: unknown[]) {
  const nextChildren = [...children] as Array<{ type?: string; data?: { directiveLabel?: boolean }; children?: PhrasingContent[] }>;
  const titleNodeIndex = nextChildren.findIndex((child) => child.type === 'paragraph' && child.data?.directiveLabel);
  const title =
    titleNodeIndex >= 0 && nextChildren[titleNodeIndex]?.children
      ? phrasingContentToText(nextChildren[titleNodeIndex].children)
      : undefined;

  if (titleNodeIndex >= 0) {
    nextChildren.splice(titleNodeIndex, 1);
  }

  return {
    children: nextChildren,
    title,
  };
}

function phrasingContentToText(children: PhrasingContent[]): string {
  return children
    .map((child) => {
      if ('value' in child && typeof child.value === 'string') return child.value;
      if ('children' in child && Array.isArray(child.children)) return phrasingContentToText(child.children as PhrasingContent[]);
      return '';
    })
    .join('');
}

function getStringAttribute(attributes: Record<string, unknown>, name: string) {
  const value = attributes[name];
  return typeof value === 'string' ? value : undefined;
}

function createStringAttributes(attributes: Record<string, unknown>, names: string[]) {
  return names.flatMap((name) => {
    const value = getStringAttribute(attributes, name);
    return value === undefined ? [] : [createMdxAttribute(name, value)];
  });
}

function createMdxAttribute(name: string, value: string | number) {
  return {
    type: 'mdxJsxAttribute',
    name,
    value: String(value),
  };
}

function createStrongParagraph(value: string) {
  return {
    type: 'paragraph',
    children: [
      {
        type: 'strong',
        children: [
          {
            type: 'text',
            value,
          },
        ],
      },
    ],
  };
}
