// How a `.diagram.json` is written, by the importer now and by the Studio
// editor and agent tools later: two-space JSON, with each small leaf object
// or array (a position box, a waypoint, a member list) kept on one line, so
// moving a node changes one line of the diff.

const LEAF_WIDTH = 120;

function isLeaf(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((item) => item === null || typeof item !== 'object' || (Array.isArray(item) && isLeaf(item)));
  if (value && typeof value === 'object') return Object.values(value).every((item) => item === null || typeof item !== 'object');
  return true;
}

function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return entries.length ? `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${oneLine(item)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

function format(value: unknown, indent: string): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inline = isLeaf(value) ? oneLine(value) : null;
  if (inline !== null && inline.length + indent.length <= LEAF_WIDTH) return inline;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((item) => `${inner}${format(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${format(item, inner)}`).join(',\n')}\n${indent}}`;
}

export function formatDiagramJson(diagram: unknown) {
  return `${format(diagram, '')}\n`;
}
