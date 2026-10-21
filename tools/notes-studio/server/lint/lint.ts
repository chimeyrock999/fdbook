import type { Root } from 'mdast';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { checkComponents } from './rules/components.ts';
import { checkDirectives } from './rules/directives.ts';
import { checkLinks } from './rules/links.ts';
import { pointOf, type LintContext, type LintIssue } from './types.ts';

// The site's syntax: fumadocs-mdx (MDX + GFM) plus remark-directive.
const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkDirective);

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/;

// Blanks the frontmatter instead of cutting it, so positions stay the file's.
function parseNote(source: string): Root {
  const blanked = source.replace(FRONTMATTER, (block) => block.replace(/[^\r\n]/g, ' '));
  return processor.parse(blanked);
}

type ParseError = { reason?: unknown; message?: unknown; place?: unknown };
type Place = { line: number; column: number; offset?: number };

function isPoint(value: unknown): value is Place {
  return typeof value === 'object' && value !== null && typeof (value as Place).line === 'number';
}

function parseIssue(error: unknown): LintIssue {
  const { reason, message, place } = (error ?? {}) as ParseError;
  const range = place as { start?: unknown; end?: unknown } | undefined;
  const start = isPoint(place) ? place : isPoint(range?.start) ? range.start : { line: 1, column: 1, offset: 0 };
  const end = isPoint(range?.end) ? range.end : start;
  const text = typeof reason === 'string' ? reason : typeof message === 'string' ? message : String(error);
  return {
    rule: 'mdx-parse',
    severity: 'error',
    message: `The note does not parse: ${text}`,
    start: pointOf(start),
    end: pointOf(end),
  };
}

// Checks one note against the site's rules. Never throws: a note that does
// not parse comes back as a single `mdx-parse` issue.
export function lintNote(source: string, context: LintContext): LintIssue[] {
  let tree: Root;
  try {
    tree = parseNote(source);
  } catch (error) {
    return [parseIssue(error)];
  }
  const issues: LintIssue[] = [];
  const report = (issue: LintIssue) => {
    issues.push(issue);
  };
  checkDirectives(tree, source, report);
  checkComponents(tree, source, context, report);
  checkLinks(tree, context, report);
  return issues.sort((a, b) => a.start.offset - b.start.offset);
}
