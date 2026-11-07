import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { diagramPalette, paintDiagramSvg } from '#render/paint.ts';

const require = createRequire(import.meta.url);
const css = readFileSync(new URL('../../styles/diagram.css', import.meta.url), 'utf8');
const fumadocs = readFileSync(require.resolve('fumadocs-ui/css/lib/default-colors.css'), 'utf8');

const hexOf = ([r, g, b]: number[]) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const colour = (palette: ReturnType<typeof diagramPalette>, name: string) => {
  const value = palette.get(name);
  if (!value) throw new Error(`no ${name}`);
  return { hex: hexOf(value), alpha: Math.round(value[3] * 100) / 100 };
};

describe('diagramPalette', () => {
  it('reads the surfaces and text from the fumadocs theme', () => {
    const light = diagramPalette(css, 'light', fumadocs);
    // fumadocs neutral: card hsl(0 0% 94.7%), foreground hsl(0 0% 3.9%).
    expect(colour(light, '--dg-bg')).toEqual({ hex: '#f1f1f1', alpha: 1 });
    expect(colour(light, '--text')).toEqual({ hex: '#0a0a0a', alpha: 1 });
    expect(colour(light, '--text-muted')).toEqual({ hex: '#737373', alpha: 1 });
    expect(colour(light, '--panel-border')).toEqual({ hex: '#cccccc', alpha: 0.5 });

    const dark = diagramPalette(css, 'dark', fumadocs);
    expect(colour(dark, '--dg-bg')).toEqual({ hex: '#191919', alpha: 1 });
    expect(colour(dark, '--text')).toEqual({ hex: '#ebebeb', alpha: 1 });
    expect(colour(dark, '--text-muted')).toEqual({ hex: '#b3b3b3', alpha: 0.8 });
    expect(colour(dark, '--mask')).toEqual({ hex: '#1e1e1e', alpha: 1 });
  });

  it('falls back to fumadocs neutral without the theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const themed = diagramPalette(css, theme, fumadocs);
      const bare = diagramPalette(css, theme);
      for (const name of ['--dg-bg', '--text', '--text-muted', '--panel', '--panel-border', '--mask', '--dg-hover']) {
        expect(colour(bare, name), `${theme} ${name}`).toEqual(colour(themed, name));
      }
    }
  });

  it('follows a theme that sets its own tokens', () => {
    const custom = '@theme {\n  --color-fd-card: #102030;\n}\n.dark {\n  --color-fd-card: rgb(1 2 3);\n}\n';
    expect(colour(diagramPalette(css, 'light', custom), '--dg-bg').hex).toBe('#102030');
    expect(colour(diagramPalette(css, 'dark', custom), '--dg-bg').hex).toBe('#010203');
  });
});

describe('paintDiagramSvg', () => {
  it('lays the canvas colour under the drawing', () => {
    const svg = paintDiagramSvg('<svg class="dg-svg" viewBox="0 0 10 20"><text class="t-primary">a</text></svg>', diagramPalette(css, 'dark', fumadocs), { theme: 'dark' });
    expect(svg).toContain('<rect width="10" height="20" fill="#191919"/>');
    expect(svg).toContain('<text class="t-primary" fill="#ebebeb" fill-opacity="1">');
  });
});
