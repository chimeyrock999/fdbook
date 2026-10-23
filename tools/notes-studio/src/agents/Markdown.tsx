import type { Nodes, Table } from 'mdast';
import { createElement, memo, useMemo, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { safeHref } from './safe-href';

// An agent's reply, as markdown (GFM). The text is the agent's, so it is
// drawn element by element from the syntax tree: raw HTML shows as text,
// links go only to the web or an email address, and an image shows as a
// link (the Studio loads nothing an agent names). Text streamed in chunks
// renders as a whole once more on every chunk: an unclosed fence is a code
// block to the end, so half a reply does not jump.

const parser = unified().use(remarkParse).use(remarkGfm);

const all = (nodes: Nodes[], tight = false) => nodes.map((node, index) => draw(node, index, tight));

function table(node: Table, key: number) {
  const head = node.children.at(0);
  const rows = node.children.slice(1);
  const align = (index: number) => node.align?.[index] ?? undefined;
  return (
    <div key={key} className="studio-md-table">
      <table>
        {head !== undefined && (
          <thead>
            <tr>{head.children.map((cell, index) => <th key={index} align={align(index)}>{all(cell.children)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, at) => <tr key={at}>{row.children.map((cell, index) => <td key={index} align={align(index)}>{all(cell.children)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

// One node. `tight`: a paragraph in a tight list item draws its text alone.
function draw(node: Nodes, key: number, tight = false): ReactNode {
  switch (node.type) {
    case 'root':
      return all(node.children);
    case 'paragraph':
      return tight ? all(node.children) : <p key={key}>{all(node.children)}</p>;
    case 'heading':
      return createElement(`h${String(node.depth)}`, { key }, all(node.children));
    case 'text':
      return node.value;
    case 'emphasis':
      return <em key={key}>{all(node.children)}</em>;
    case 'strong':
      return <strong key={key}>{all(node.children)}</strong>;
    case 'delete':
      return <del key={key}>{all(node.children)}</del>;
    case 'inlineCode':
      return <code key={key}>{node.value}</code>;
    case 'code':
      return <pre key={key}><code data-lang={node.lang ?? undefined}>{node.value}</code></pre>;
    case 'blockquote':
      return <blockquote key={key}>{all(node.children)}</blockquote>;
    case 'list': {
      const items = node.children.map((item, index) => (
        <li key={index}>
          {item.checked != null && <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? 'Done' : 'Not done'} />}
          {all(item.children, node.spread !== true && item.spread !== true)}
        </li>
      ));
      return node.ordered === true ? <ol key={key} start={node.start ?? undefined}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'thematicBreak':
      return <hr key={key} />;
    case 'break':
      return <br key={key} />;
    case 'link': {
      const href = safeHref(node.url);
      return href === null ? <span key={key}>{all(node.children)}</span> : <a key={key} href={href} target="_blank" rel="noopener noreferrer">{all(node.children)}</a>;
    }
    case 'image': {
      const href = safeHref(node.url);
      const label = node.alt === null || node.alt === undefined || node.alt === '' ? node.url : node.alt;
      return href === null ? label : <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
    }
    case 'linkReference':
      return <span key={key}>{all(node.children)}</span>;
    case 'imageReference':
      return node.alt ?? '';
    case 'table':
      return table(node, key);
    case 'html':
      return node.value;
    case 'footnoteReference':
      return `[^${node.label ?? node.identifier}]`;
    case 'footnoteDefinition':
      return <div key={key} className="studio-md-footnote">{`[^${node.label ?? node.identifier}]: `}{all(node.children, true)}</div>;
    default:
      return null;
  }
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className: string }) {
  const tree = useMemo(() => parser.parse(text), [text]);
  return <div className={`studio-md ${className}`}>{draw(tree, 0)}</div>;
});
