/**
 * Marks the parts of a Pele diagram the author filled (`style X fill:…`,
 * `classDef`), so the dark theme can give their labels dark ink
 * (styles/notes-theme.css). CSS alone misses two cases: a fill written as a
 * name or `rgb()`, and a subgraph title Pele lifts out of its subgraph, into
 * `.pele-cluster-titles`, when an edge crosses it; only its `data-id` ties it
 * back to the subgraph. Such a title also carries the subgraph's fill as
 * `--author-fill`, for the halo Pele draws behind it.
 */

const MARK = 'data-author-fill';
// Pele writes an author's fill inline on the shape; `none` and
// `transparent` are no colour for the label to sit on.
const AUTHOR_FILL = /(?:^|;)\s*fill\s*:([^;]+)/i;
const NO_FILL = /^(?:none|transparent)$/i;

export function markAuthorFills(root: ParentNode): void {
  const filled = new Map<string, string>();

  root.querySelectorAll('svg.pele :is(.pele-node, .pele-cluster)').forEach((group) => {
    const shape = [...group.children].find((child) => !child.matches('text, .pele-label, .pele-cluster-label'));
    const fill = AUTHOR_FILL.exec(shape?.getAttribute('style') ?? '')?.[1].trim();
    if (!fill || NO_FILL.test(fill)) return;
    group.setAttribute(MARK, '');
    if (group.matches('.pele-cluster')) filled.set(group.getAttribute('data-id') ?? '', fill);
  });

  root.querySelectorAll<SVGElement>('svg.pele .pele-cluster-title[data-id]').forEach((title) => {
    const fill = filled.get(title.getAttribute('data-id') ?? '');
    if (fill === undefined) return;
    title.setAttribute(MARK, '');
    title.style.setProperty('--author-fill', fill);
  });
}

/** The same, on markup Pele returned: what the site caches and shows. */
export function markAuthorFillsInSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;

  markAuthorFills(doc);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/**
 * Marks every diagram under `root` now and whenever one is added, for
 * markup drawn by code we do not own (the Studio editor's preview). Returns
 * the call that stops it.
 */
export function observeAuthorFills(root: Element): () => void {
  markAuthorFills(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('svg.pele') || node.querySelector('svg.pele'))) markAuthorFills(node.parentElement ?? node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  return () => observer.disconnect();
}
