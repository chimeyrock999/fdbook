import { markdown } from '@codemirror/lang-markdown';
import { yaml, yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { highlight, theme } from '#features/editor/source-theme.ts';

// Below this pane width the two sides share one column.
export const SPLIT_MIN_WIDTH = 720;
const COLLAPSE = { margin: 3, minSize: 4 };

// The language a file is read in: a note's MDX with its frontmatter, a
// meta.yaml as YAML, anything else (an SVG) as plain text.
function languageOf(path: string): Extension[] {
  if (path.endsWith('.mdx')) return [yamlFrontmatter({ content: markdown() })];
  if (path.endsWith('.yaml')) return [yaml()];
  return [];
}

// The pane's width, as it changes: null until it was measured (an
// observer reports the size it starts with). Without ResizeObserver it is
// measured once.
function useWidth(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (typeof ResizeObserver === 'undefined') {
      const frame = requestAnimationFrame(() => { setWidth(node.clientWidth); });
      return () => { cancelAnimationFrame(frame); };
    }
    const observer = new ResizeObserver(() => { setWidth(node.clientWidth); });
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, [element]);
  return width;
}

// The raw diff: main's text (`before`) against the change request's
// (`after`) in CodeMirror's merge view, read only, unchanged lines folded.
// Side by side in a wide pane, one column (removed lines over added ones)
// in a narrow one. A missing side is empty.
export function SourceDiff({ path, before, after }: { path: string; before: string; after: string }) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  const split = width !== null && width >= SPLIT_MIN_WIDTH;

  useEffect(() => {
    const parent = host.current;
    if (!parent || width === null) return;
    const extensions = [
      lineNumbers(),
      ...languageOf(path),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      theme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ];
    if (split) {
      const view = new MergeView({ a: { doc: before, extensions }, b: { doc: after, extensions }, parent, collapseUnchanged: COLLAPSE, gutter: true });
      return () => { view.destroy(); };
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: after, extensions: [...extensions, unifiedMergeView({ original: before, mergeControls: false, collapseUnchanged: COLLAPSE })] }),
    });
    return () => { view.destroy(); };
    // `width` only matters for which layout; a resize within one keeps the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, before, after, split, width === null]);

  return <div ref={host} className="studio-source-diff" data-layout={split ? 'split' : 'unified'} data-testid="source-diff" />;
}
