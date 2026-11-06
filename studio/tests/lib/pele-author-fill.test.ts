// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAsync } from 'pele/lazy';
import { describe, expect, it } from 'vitest';
import { markAuthorFills, markAuthorFillsInSvg, observeAuthorFills } from '@site/lib/pele-author-fill';

// The dark theme gives a label on an author's fill dark ink
// (styles/notes-theme.css); these marks are what that rule reads.

const chart = `flowchart LR
  subgraph G1["Named"]
    A["Alpha"] --> B(("Beta"))
  end
  subgraph G2["Plain"]
    C{"Gamma"}
  end
  A --> C
  D[/"Delta"/]:::warm
  E["Epsilon"]
  classDef warm fill:#fde,stroke:#f00
  style A fill:#FFF9C4
  style B fill:lightgreen
  style C stroke:#f00
  style E fill:none
  style G1 fill:pink`;

function svgOf(markup: string) {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

const marked = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].filter((group) => group.hasAttribute('data-author-fill')).map((group) => group.getAttribute('data-id'));

describe('markAuthorFills', () => {
  it('marks nodes and subgraphs filled with a hex or a colour name, not stroke-only or fill:none', async () => {
    const root = svgOf((await renderAsync(chart, {})).svg);
    markAuthorFills(root);
    expect(marked(root, '.pele-node').sort()).toEqual(['A', 'B', 'D']);
    expect(marked(root, '.pele-cluster')).toEqual(['G1']);
  });

  it('reads the fill as written, spaces and case included', () => {
    const root = svgOf(
      ['fill: none', 'FILL: Transparent', 'fill: #fde', 'rx:4px; fill :LightBlue'].map((style, index) =>
        `<svg class="pele"><g class="pele-node" data-id="N${String(index)}"><rect style="${style}"/><text class="pele-label">x</text></g></svg>`,
      ).join(''),
    );
    markAuthorFills(root);
    expect(marked(root, '.pele-node')).toEqual(['N2', 'N3']);
  });

  it('marks a subgraph title Pele lifted out of its subgraph (MapReduce note)', async () => {
    const note = readFileSync(join(process.cwd(), '../../content/docs/distributed-systems/mapreduce/index.mdx'), 'utf8');
    const start = note.lastIndexOf('```mermaid', note.indexOf('HDFS_INT'));
    const block = note.slice(note.indexOf('\n', start) + 1, note.indexOf('```', start + 10));
    expect(block).toContain('style HDFS_INT fill:#FFF9C4');
    const root = svgOf((await renderAsync(block, {})).svg);
    markAuthorFills(root);
    const title = root.querySelector<SVGGElement>('.pele-cluster-title[data-id="HDFS_INT"]');
    expect(title?.getAttribute('data-author-fill')).toBe('');
    expect(title?.style.getPropertyValue('--author-fill')).toBe('#FFF9C4');
    expect(root.querySelector('.pele-cluster-title[data-id="HDFS_INT"] > .pele-cluster-label')?.textContent).toBe('HDFS Internals');
  });

  // A subgraph the author cleared (`fill:transparent`) shows the surface
  // behind it, so the halo of its lifted title takes that surface.
  it('gives a lifted title of a cleared subgraph the surface for its halo (MapReduce note)', async () => {
    const note = readFileSync(join(process.cwd(), '../../content/docs/distributed-systems/mapreduce/index.mdx'), 'utf8');
    const start = note.lastIndexOf('```mermaid', note.indexOf('subgraph MapPhase'));
    const block = note.slice(note.indexOf('\n', start) + 1, note.indexOf('```', start + 10));
    expect(block).toContain('style MapPhase fill:transparent');
    const root = svgOf((await renderAsync(block, {})).svg);
    markAuthorFills(root);
    expect(marked(root, '.pele-cluster')).toEqual([]);
    const title = root.querySelector<SVGGElement>('.pele-cluster-title[data-id="MapPhase"]');
    expect(title?.getAttribute('data-author-fill')).toBe('none');
    expect(title?.style.getPropertyValue('--author-fill')).toBe('var(--_bg)');
  });

  // Pele mixes a nested title's halo for every subgraph under it; a flat
  // mix from one fill would show as a plate there, so Pele's is kept.
  it('leaves the halo of a nested subgraph title to Pele', async () => {
    const root = svgOf(
      (
        await renderAsync(
          `flowchart TB
  subgraph Outer["Outer"]
    subgraph Inner["Inner title"]
      a1 --> a2
    end
    b1
  end
  x --> a1
  b1 --> a2
  style Inner fill:transparent
  style Outer fill:#FFF9C4`,
          {},
        )
      ).svg,
    );
    markAuthorFills(root);
    expect(root.querySelector('.pele-cluster-title[data-id="Inner"] > text')?.getAttribute('stroke')).toContain('75%');
    expect(root.querySelector('.pele-cluster-title[data-id="Inner"]')?.hasAttribute('data-author-fill')).toBe(false);
    expect(marked(root, '.pele-cluster')).toEqual(['Outer']);
  });

  // Ink the author picked for a fill reads on that fill at Pele's strength,
  // not on the dark theme's tint.
  it('marks a subgraph whose title has the author colour, lifted or not', async () => {
    const root = svgOf(
      (
        await renderAsync(
          `flowchart TB
  subgraph G1["Inked"]
    a --> b
  end
  subgraph G2["Plain"]
    c
  end
  x --> b
  style G1 fill:#FFF9C4,color:#000000
  style G2 fill:#FFF9C4`,
          {},
        )
      ).svg,
    );
    markAuthorFills(root);
    const inked = [...root.querySelectorAll('[data-author-color]')].map((group) => `${group.getAttribute('class') ?? ''} ${group.getAttribute('data-id') ?? ''}`);
    expect(inked.length).toBeGreaterThan(0);
    expect(inked.every((entry) => entry.endsWith(' G1'))).toBe(true);
    expect(root.querySelector('.pele-cluster[data-id="G1"]')?.hasAttribute('data-author-color')).toBe(true);
  });

  it('marks the markup the site caches, keeping it an svg', async () => {
    const next = markAuthorFillsInSvg((await renderAsync(chart, {})).svg);
    expect(next.startsWith('<svg')).toBe(true);
    expect(marked(svgOf(next), '.pele-node').sort()).toEqual(['A', 'B', 'D']);
  });

  it('marks a diagram added later under an observed element, until disconnected', async () => {
    const host = document.createElement('section');
    document.body.append(host);
    const stop = observeAuthorFills(host);
    const svg = (await renderAsync(chart, {})).svg;
    const preview = document.createElement('div');
    preview.innerHTML = svg;
    host.append(preview);
    await Promise.resolve();
    expect(marked(host, '.pele-node').sort()).toEqual(['A', 'B', 'D']);
    preview.innerHTML = svg; // the editor replaces the markup on each edit
    await Promise.resolve();
    expect(marked(host, '.pele-node').sort()).toEqual(['A', 'B', 'D']);
    stop();
    preview.innerHTML = svg;
    await Promise.resolve();
    expect(marked(host, '.pele-node')).toEqual([]);
    host.remove();
  });
});
