import { createElement, type IconNode } from 'lucide';

// A lucide icon as an SVG element, for decorations built as plain DOM (the
// React components draw with lucide-react).
export function icon(node: IconNode, size: number): SVGElement {
  return createElement(node, { width: size, height: size, 'aria-hidden': 'true' });
}
