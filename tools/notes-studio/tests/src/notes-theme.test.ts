import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../server/config';

// The Studio draws with the site's notes theme (styles/notes-theme.css) and
// prose (styles/notes-prose.css), imported, not copied: a change there shows
// in the Studio with no Studio edit.

const read = (path: string) => readFile(join(repoRoot, path), 'utf8');

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
    const studio = await read('tools/notes-studio/src/notes-theme.css');
    expect(studio).toContain("@import '../../../styles/notes-theme.css';");
    const rules = studio.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it('maps every --fde-* token onto a site token in light and dark', async () => {
    const studio = values(block(await read('tools/notes-studio/src/notes-theme.css'), '\n.notes-theme'));
    const site = await read('styles/notes-theme.css');
    const light = values(block(site, '\n.notes-theme'));
    const dark = values(block(site, '.dark .notes-theme'));
    const mapped = Object.entries(studio).filter(([name]) => name.startsWith('--fde-'));
    expect(mapped.length).toBeGreaterThan(20);
    for (const [name, value] of mapped) {
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      expect(token, name).toBeDefined();
      expect(light[token ?? ''], `${name} light`).toBeDefined();
      expect(dark[token ?? ''], `${name} dark`).toBeDefined();
    }
  });

  // The .notes-theme palette, which the Studio draws with. The site's own
  // @theme and global .dark blocks still repeat the values for its Tailwind
  // utilities: #72.
  it('keeps the .notes-theme palette in the shared file only', async () => {
    const notes = await read('app/notes/notes.css');
    expect(notes).toContain("@import '../../styles/notes-theme.css';");
    expect(notes).not.toMatch(/(^|\n)(\.dark )?\.notes-theme \{[^}]*--color-callout-/);
  });

  it('dark is the site class the Studio sets on <html>', async () => {
    const site = await read('styles/notes-theme.css');
    expect(site).toContain('.dark .notes-theme {');
    const html = await read('tools/notes-studio/index.html');
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
    const index = await read('tools/notes-studio/src/index.css');
    expect(index.indexOf("@import '../../../styles/notes-prose.css';")).toBeGreaterThan(-1);
    expect(index.indexOf("@import '../../../styles/notes-prose.css';")).toBeLessThan(index.indexOf("@import './notes-prose.css';"));
    expect(await read('tools/notes-studio/src/editor/NoteEditor.tsx')).toContain('className="studio-prose notes-prose"');
    expect(await read('app/notes/[[...slug]]/page.tsx')).toContain('className="notes-prose"');
  });

  // What is left styles only the editor's own DOM: the header's text areas,
  // its code block frame and where its markup differs from the page's.
  it('leaves only editor rules in src/notes-prose.css', async () => {
    const studio = selectors(await read('tools/notes-studio/src/notes-prose.css'));
    expect(studio.length).toBeGreaterThan(5);
    for (const selector of studio) expect(selector).toMatch(/\.studio-(?!prose\b)|\.studio-prose\.notes-prose|figure\[dir='ltr'\]/);
  });

  it('leaves no prose rule in the page module', async () => {
    const module = await read('app/notes/notes.module.css');
    expect(module).not.toContain('.body');
    expect(module).not.toContain(':global(.notes-');
  });
});
