import type { Node } from 'unist';

export type LintRule =
  | 'mdx-parse'
  | 'directive-unknown'
  | 'directive-unclosed'
  | 'directive-nesting'
  | 'callout-type'
  | 'callout-style'
  | 'accordion-kind'
  | 'accordion-group'
  | 'link-broken'
  | 'asset-missing'
  | 'diagram-invalid'
  | 'graph-id-duplicate'
  | 'graph-meta-incomplete'
  | 'emphasis-marker';

export type LintSeverity = 'error' | 'warning';

// 1-based line and column, 0-based offset into the file, as in unist.
export type LintPoint = { line: number; column: number; offset: number };

export type LintIssue = {
  rule: LintRule;
  severity: LintSeverity;
  message: string;
  start: LintPoint;
  end: LintPoint;
};

// What a rule needs to know beyond the note itself. Paths are relative to
// content/notes (`guide/intro.mdx`); assets are relative to public/
// (`notes/guide/demo.html`); a diagram is its `<Diagram src>`, the path under
// diagrams/ without `.diagram.json`.
export type LintContext = {
  path: string;
  pages: ReadonlySet<string>;
  assetExists: (asset: string) => boolean;
  // What keeps a diagram from drawing as the site draws it: null when it
  // draws cleanly, `missing` when there is no such file.
  diagramProblem: (src: string) => DiagramProblem | null;
};

export type DiagramProblem = 'missing' | { severity: LintSeverity; message: string };

export type Report = (issue: LintIssue) => void;

export function pointOf(point: { line: number; column: number; offset?: number | undefined }): LintPoint {
  return { line: point.line, column: point.column, offset: point.offset ?? 0 };
}

// The node's first line: the part to select for a block that spans many.
export function headOf(node: Node, source: string): Pick<LintIssue, 'start' | 'end'> {
  const position = node.position;
  if (!position) return { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
  const start = pointOf(position.start);
  const end = pointOf(position.end);
  if (end.line === start.line) return { start, end };
  const lineEnd = source.slice(start.offset).search(/\r?\n/);
  const length = lineEnd === -1 ? end.offset - start.offset : lineEnd;
  return { start, end: { line: start.line, column: start.column + length, offset: start.offset + length } };
}
