/**
 * Marks the parts of a Pele diagram the author filled (`style X fill:…`,
 * `classDef`) for the dark theme (styles/notes-theme.css): a node keeps its
 * fill and gets dark ink, a subgraph is tinted instead. CSS alone misses two
 * cases: a fill written as a colour name (`fill:lightblue`), and a subgraph
 * title Pele lifts out of its subgraph, into `.pele-cluster-titles`, when an
 * edge crosses it; only its `data-id` ties it back to the subgraph.
 *
 * Such a title also carries what is behind it as `--author-fill`, for the
 * halo Pele draws there: the subgraph's fill, or the surface (marked `none`)
 * when the author cleared it. A subgraph whose label has the author's
 * `color:` is marked `data-author-color` on both parts, as that ink was
 * picked for the fill at full strength.
 */

const MARK = 'data-author-fill';
const COLOR_MARK = 'data-author-color';
// Pele writes an author's fill inline on the shape; `none` and
// `transparent` are no colour for the label to sit on.
const AUTHOR_FILL = /(?:^|;)\s*fill\s*:([^;]+)/i;
const NO_FILL = /^(?:none|transparent)$/i;

export function markAuthorFills(root: ParentNode): void {
  const filled = new Map<string, string | null>();
  const colored = new Set<string>();

  root.querySelectorAll('svg.pele :is(.pele-node, .pele-cluster)').forEach((group) => {
    const shape = [...group.children].find((child) => !child.matches('text, .pele-label, .pele-cluster-label'));
    const fill = AUTHOR_FILL.exec(shape?.getAttribute('style') ?? '')?.[1].trim();
    if (!fill) return;
    const cleared = NO_FILL.test(fill);
    if (!cleared) group.setAttribute(MARK, '');
    if (!group.matches('.pele-cluster')) return;
    const id = group.getAttribute('data-id') ?? '';
    filled.set(id, cleared ? null : fill);
    if (hasAuthorColor(group)) colored.add(id);
  });

  root.querySelectorAll<SVGElement>('svg.pele .pele-cluster-title[data-id]').forEach((title) => {
    const id = title.getAttribute('data-id') ?? '';
    const fill = filled.get(id);
    if (fill === undefined) return;
    if (hasAuthorColor(title)) colored.add(id);
    const halo = title.querySelector(':scope > text:not(.pele-cluster-label)');
    if (!(halo?.getAttribute('stroke') ?? '').includes('var(--_a) 50%')) return;
    title.setAttribute(MARK, fill === null ? 'none' : '');
    title.style.setProperty('--author-fill', fill ?? 'var(--_bg)');
  });

  root.querySelectorAll('svg.pele :is(.pele-cluster, .pele-cluster-title)[data-id]').forEach((group) => {
    if (colored.has(group.getAttribute('data-id') ?? '')) group.setAttribute(COLOR_MARK, '');
  });
}

function hasAuthorColor(group: Element) {
  return AUTHOR_FILL.test(group.querySelector(':scope > .pele-cluster-label')?.getAttribute('style') ?? '');
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

  return () => { observer.disconnect(); };
}
