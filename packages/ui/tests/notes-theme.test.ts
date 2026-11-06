import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRoot } from '@fdbook/server/config.ts';

// The Studio draws with the site's notes theme (styles/notes-theme.css) and
// prose (styles/notes-prose.css), imported, not copied: a change there shows
// in the Studio with no Studio edit.

const read = (path: string) => readFile(join(installRoot, path), 'utf8');

const LIGHT = ':root:has(.notes-theme), .notes-theme';
const DARK = '.dark:has(.notes-theme), .dark .notes-theme';
const PALETTE = /^--(color-fd|garden|color-graph|color-callout)-/;

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found`);
  return css.slice(start, css.indexOf('}', start));
}

function values(css: string) {
  return Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// Selectors of the top-level rules and of those inside @media.
function selectors(css: string) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}@;]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
}

describe('notes theme', () => {
  it('imports the site theme and copies no value', async () => {
    const studio = await read('packages/ui/src/notes-theme.css');
    expect(studio).toContain("@import '@fdbook/mdx/styles/notes-theme.css';");
    const rules = studio.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it('maps every --fde-* token onto a site token in light and dark', async () => {
    const studio = values(block(await read('packages/ui/src/notes-theme.css'), '\n.notes-theme'));
    const site = await read('packages/mdx/styles/notes-theme.css');
    const light = values(block(site, LIGHT));
    const dark = values(block(site, DARK));
    const mapped = Object.entries(studio).filter(([name]) => name.startsWith('--fde-'));
    expect(mapped.length).toBeGreaterThan(20);
    for (const [name, value] of mapped) {
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      expect(token, name).toBeDefined();
      expect(light[token ?? ''], `${name} light`).toBeDefined();
      expect(dark[token ?? ''], `${name} dark`).toBeDefined();
    }
  });

  // On the page too, so what renders outside the notes layout (the search
  // dialog and popovers portal to <body>) keeps the garden colours; only
  // while it shows the layout, since the notes CSS stays loaded after a
  // client-side navigation to another page.
  it('sets the palette on the page and on .notes-theme', async () => {
    const site = await read('packages/mdx/styles/notes-theme.css');
    const light = values(block(site, LIGHT));
    expect(light['--color-fd-card']).toBeDefined();
    expect(light['--color-callout-info']).toBeDefined();
    expect(values(block(site, DARK))['--color-fd-card']).toBeDefined();
    const parts = selectors(site).flatMap((s) => s.split(',').map((p) => p.trim()));
    expect(parts).not.toContain(':root');
    expect(parts).not.toContain('.dark');
    // The fonts read next/font variables set on the notes layout only.
    expect(light['--font-sans']).toBeUndefined();
    expect(values(block(site, '\n.notes-theme'))['--font-sans']).toBeDefined();
  });

  it('writes each palette value once, in styles/notes-theme.css', async () => {
    const copies: string[] = [];
    for await (const path of glob('{app,packages/mdx/styles,packages/mdx/components,packages/ui/src}/**/*.css', { cwd: installRoot })) {
      if (path === 'packages/mdx/styles/notes-theme.css') continue;
      const css = (await read(path)).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        if (!PALETTE.test(name) || value.trim().startsWith('var(')) continue;
        if (name === '--garden-leaf-mask') continue; // an image, not a colour
        // The home page has its own fumadocs palette.
        if (name.startsWith('--color-fd-') && path.startsWith('app/(home)/')) continue;
        copies.push(`${path}: ${name}`);
      }
    }
    expect(copies).toEqual([]);
  });

  it('dark is the site class the Studio sets on <html>', async () => {
    const site = await read('packages/mdx/styles/notes-theme.css');
    expect(site).toContain(`${DARK} {`);
    const html = await read('packages/ui/index.html');
    expect(html).toContain('<body class="notes-theme">');
    // Set before the first paint, so a dark system never flashes light, and
    // kept in step when the system switches.
    expect(html.indexOf("classList.toggle('dark'")).toBeGreaterThan(-1);
    expect(html.indexOf("classList.toggle('dark'")).toBeLessThan(html.indexOf('src/main.tsx'));
    expect(html).toContain("addEventListener('change'");
  });
});

describe('notes prose', () => {
  it('is imported from the site and drawn on the editor', async () => {
    const index = await read('packages/ui/src/index.css');
    expect(index.indexOf("@import '../../styles/notes-prose.css';")).toBeGreaterThan(-1);
    expect(index.indexOf("@import '../../styles/notes-prose.css';")).toBeLessThan(index.indexOf("@import './notes-prose.css';"));
    expect(await read('packages/ui/src/editor/NoteEditor.tsx')).toContain('className="studio-prose notes-prose"');
    expect(await read('app/notes/[[...slug]]/page.tsx')).toContain('className="notes-prose"');
  });

  // What is left styles only the editor's own DOM: the header's text areas,
  // its code block frame and where its markup differs from the page's.
  it('leaves only editor rules in src/notes-prose.css', async () => {
    const studio = selectors(await read('packages/ui/src/notes-prose.css'));
    expect(studio.length).toBeGreaterThan(5);
    for (const selector of studio) expect(selector).toMatch(/\.studio-(?!prose\b)|\.studio-prose\.notes-prose|figure\[dir='ltr'\]/);
  });

  // Pele paints the plate behind an edge label in --pele-bg: transparent
  // lets the line run through the text. Each surface a diagram sits on
  // names its colour, and the dark label ink follows the marks
  // packages/mdx/src/pele-author-fill.ts sets (a lifted subgraph title included).
  it('gives diagram label plates the surface and dark ink the author-fill mark', async () => {
    const site = await read('packages/mdx/styles/notes-theme.css');
    expect(values(block(site, ':root:has(.notes-theme) svg.pele, .notes-theme svg.pele'))['--pele-bg']).toBe(
      'var(--notes-diagram-bg, var(--color-fd-background))',
    );
    expect(site).not.toMatch(/fill:#"\]/);
    expect(site).toContain('.dark .notes-theme svg.pele .pele-node[data-author-fill] > .pele-label');
    expect(site).not.toMatch(/\[data-author-fill\] > :is\(.pele-label, .pele-cluster-label\)/);
    expect(await read('components/graph-view.module.css')).toMatch(/--notes-diagram-bg:[^;]+;\s*background: var\(--notes-diagram-bg\);/);
    const prose = await read('packages/mdx/styles/notes-prose.css');
    expect(prose).toContain('--notes-diagram-bg: var(--notes-callout-surface);');
    expect(prose).toContain('--notes-diagram-bg: var(--notes-tab-content-surface);');
    const studio = await read('packages/ui/src/notes-prose.css');
    expect(studio.match(/--notes-diagram-bg:[^;]+;/g)).toHaveLength(2);
    expect(studio.match(/background: var\(--notes-diagram-bg\);/g)).toHaveLength(2);
  });

  // Pele fills a subgraph at half strength over the background: pale on the
  // light page, muddy on the dark one. The dark theme tints it instead, and
  // the halo of a lifted title mixes at the same strength to match.
  it('tints author-filled subgraphs in the dark theme, halo included', async () => {
    const site = await read('packages/mdx/styles/notes-theme.css');
    expect(values(block(site, ':root:has(.notes-theme) svg.pele, .notes-theme svg.pele'))['--notes-cluster-tint']).toBe('0.5');
    expect(values(block(site, '.dark .notes-theme svg.pele, .dark:has(.notes-theme) svg.pele'))['--notes-cluster-tint']).toBe('0.22');
    expect(values(block(site, '.notes-theme svg.pele [data-author-color]'))['--notes-cluster-tint']).toBe('0.5');
    expect(block(site, '.notes-theme svg.pele .pele-cluster[data-author-fill] > rect')).toContain(
      'fill-opacity: var(--notes-cluster-tint);',
    );
    expect(block(site, '.notes-theme svg.pele .pele-cluster-title[data-author-fill] > text:not(.pele-cluster-label)')).toContain(
      'stroke: color-mix(in srgb, var(--author-fill) calc(var(--notes-cluster-tint) * 100%), var(--_bg));',
    );
  });

  it('leaves no prose rule in the page module', async () => {
    const module = await read('app/notes/notes.module.css');
    expect(module).not.toContain('.body');
    expect(module).not.toContain(':global(.notes-');
  });
});
