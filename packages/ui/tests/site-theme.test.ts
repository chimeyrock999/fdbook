import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRoot } from '@fdbook/server/config.ts';

// The Studio draws with fumadocs' stock theme (fumadocs-ui's neutral colours
// and its preset's prose), imported, not copied: a fumadocs update shows in
// the Studio with no Studio edit.

const read = (path: string) => readFile(join(installRoot, path), 'utf8');
const fumadocsColors = () => readFile(createRequire(import.meta.url).resolve('fumadocs-ui/css/lib/default-colors.css'), 'utf8');

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

describe('site theme', () => {
  it('imports fumadocs-ui before mapping it, and copies no value', async () => {
    const index = await read('packages/ui/src/index.css');
    const at = (line: string) => index.indexOf(`@import '${line}';`);
    expect(at('fumadocs-ui/css/neutral.css')).toBeGreaterThan(-1);
    expect(at('fumadocs-ui/css/preset.css')).toBeGreaterThan(at('fumadocs-ui/css/neutral.css'));
    expect(at('./site-theme.css')).toBeGreaterThan(at('fumadocs-ui/css/preset.css'));
    const rules = (await read('packages/ui/src/site-theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  // Status colours are fumadocs' static ones, the same light and dark.
  it('maps every --fde-* token onto a fumadocs token in light and dark', async () => {
    const studio = values(block(await read('packages/ui/src/site-theme.css'), '\n.site-theme'));
    const colors = await fumadocsColors();
    const light = { ...values(block(colors, '@theme')), ...values(block(colors, '@theme static')) };
    const dark = { ...values(block(colors, '\n.dark')), ...values(block(colors, '@theme static')) };
    const mapped = Object.entries(studio).filter(([name]) => name.startsWith('--fde-'));
    expect(mapped.length).toBeGreaterThan(20);
    for (const [name, value] of mapped) {
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      expect(token, name).toBeDefined();
      expect(light[token ?? ''], `${name} light`).toBeDefined();
      expect(dark[token ?? ''], `${name} dark`).toBeDefined();
    }
  });

  it('dark is the class the Studio sets on <html>', async () => {
    const html = await read('packages/ui/index.html');
    expect(html).toContain('<body class="site-theme">');
    // Set before the first paint, so a dark system never flashes light, and
    // kept in step when the system switches.
    expect(html.indexOf("classList.toggle('dark'")).toBeGreaterThan(-1);
    expect(html.indexOf("classList.toggle('dark'")).toBeLessThan(html.indexOf('src/main.tsx'));
    expect(html).toContain("addEventListener('change'");
  });
});

describe('prose', () => {
  it("is fumadocs' prose, drawn on the editor", async () => {
    expect(await read('packages/ui/src/views/NoteEditor.tsx')).toContain('className="studio-prose prose"');
    expect(await read('packages/ui/src/features/diff/RenderedDiff.tsx')).toContain('className="studio-prose prose"');
  });

  // What src/prose.css holds styles only the editor's own DOM: the header's
  // text areas, its code block frame and where its markup differs from the
  // page's.
  it('leaves only editor rules in src/prose.css', async () => {
    const studio = selectors(await read('packages/ui/src/prose.css'));
    expect(studio.length).toBeGreaterThan(5);
    for (const selector of studio) expect(selector).toMatch(/\.studio-(?!prose\b)|\.studio-prose\.prose|figure\[dir='ltr'\]/);
  });
});
