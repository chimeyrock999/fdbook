// Draws a diagram as a self-contained SVG or a PNG, with no browser: the
// scene and markup the site uses, coloured by paint.ts from
// styles/diagram.css, rasterised by resvg in the notes font (Be Vietnam Pro,
// OFL, from @expo-google-fonts/be-vietnam-pro). For the CLI and for agents
// that need to look at their own result.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import { diagramPalette, paintDiagramSvg, type Theme } from './paint.ts';
import { renderDiagramSvg } from './render.ts';
import { validateDiagram, type DiagramIssue } from './validate.ts';

const require = createRequire(import.meta.url);
const FONT_WEIGHTS = ['400Regular', '500Medium', '600SemiBold', '700Bold'];

let fontFiles: string[] | null = null;
let css: { diagram: string; notes: string } | null = null;

const fonts = () => (fontFiles ??= FONT_WEIGHTS.map((weight) => require.resolve(`@expo-google-fonts/be-vietnam-pro/${weight}/BeVietnamPro_${weight}.ttf`)));
const styles = () => (css ??= {
  diagram: readFileSync(new URL('../../styles/diagram.css', import.meta.url), 'utf8'),
  notes: readFileSync(new URL('../../styles/notes-theme.css', import.meta.url), 'utf8'),
});

export interface DrawOptions {
  theme?: Theme;
  // Show node tags and second label lines, as the expanded view does.
  expanded?: boolean;
}

export interface Drawn {
  svg: string | null;
  width: number;
  height: number;
  issues: DiagramIssue[];
}

// The painted SVG of a diagram's content, or null with the issues when it
// does not draw (a schema or structure error).
export function drawDiagramSvg(value: unknown, { theme = 'light', expanded = false }: DrawOptions = {}): Drawn {
  const { scene, issues } = validateDiagram(value);
  if (!scene) return { svg: null, width: 0, height: 0, issues };
  const markup = renderDiagramSvg(scene, 'dg');
  const svg = paintDiagramSvg(markup, diagramPalette(styles().diagram, theme, styles().notes), { theme, expanded });
  return { svg, width: scene.width, height: scene.height, issues };
}

export interface DrawnPng extends Omit<Drawn, 'svg'> {
  png: Buffer | null;
}

// `scale` multiplies the canvas size; 2 keeps the small labels legible.
export function drawDiagramPng(value: unknown, { scale = 2, ...options }: DrawOptions & { scale?: number } = {}): DrawnPng {
  const { svg, width, height, issues } = drawDiagramSvg(value, options);
  if (!svg) return { png: null, width, height, issues };
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: fonts(), loadSystemFonts: false, defaultFontFamily: 'Be Vietnam Pro' },
  });
  const image = resvg.render();
  return { png: image.asPng(), width: image.width, height: image.height, issues };
}
