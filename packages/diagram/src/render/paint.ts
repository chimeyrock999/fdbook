// Turns the drawing render.ts makes, which holds classes and no colour, into
// a self-contained SVG with the colours written on each element: for an SVG
// file opened outside the site, and for the PNG an agent looks at. The
// tokens come from styles/diagram.css itself (`.dg` and `.dark .dg`) over
// the notes theme's --garden-* (@fdbook/mdx's styles/notes-theme.css) they read; the
// rules below mirror its drawing rules (`.dg-svg …`), which
// tests/diagram-paint.test.ts keeps in step.

export type Theme = 'light' | 'dark';
type Rgba = [number, number, number, number];
type Tokens = Map<string, string>;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i;

function parseColor(value: string): Rgba {
  const text = value.trim();
  if (text === 'transparent' || text === 'none') return [0, 0, 0, 0];
  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)).concat(1) as Rgba;
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  throw new Error(`diagram paint: cannot read the colour "${value}"`);
}

// CSS color-mix(in srgb, a p, b): premultiplied, as browsers mix.
function mix(a: Rgba, share: number, b: Rgba): Rgba {
  const alpha = a[3] * share + b[3] * (1 - share);
  if (alpha === 0) return [0, 0, 0, 0];
  const channel = (index: number) => (a[index] * a[3] * share + b[index] * b[3] * (1 - share)) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

const hex = ([r, g, b]: Rgba) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const opacity = (color: Rgba) => Math.round(color[3] * 1000) / 1000;

// The custom properties a rule block declares, in order.
function declarations(css: string, selector: string): Tokens {
  const start = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*():]/g, '\\$&')}\\s*\\{`));
  if (start < 0) throw new Error(`diagram paint: styles/diagram.css has no "${selector}" block`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens: Tokens = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(match[1], match[2].trim());
  return tokens;
}

const NOTES_LIGHT = ':root:has(.notes-theme), .notes-theme';
const NOTES_DARK = '.dark:has(.notes-theme), .dark .notes-theme';

// The colour tokens of a theme, with var() resolved. Without the notes
// theme, a --garden-* token takes the fallback diagram.css gives it.
export function diagramPalette(css: string, theme: Theme, notesCss?: string) {
  const blocks: [string, string][] = notesCss ? [[notesCss, NOTES_LIGHT]] : [];
  if (notesCss && theme === 'dark') blocks.push([notesCss, NOTES_DARK]);
  blocks.push([css, '.dg']);
  if (theme === 'dark') blocks.push([css, '.dark .dg']);
  const tokens: Tokens = new Map();
  for (const [source, selector] of blocks) for (const [name, value] of declarations(source, selector)) tokens.set(name, value);
  const resolve = (value: string, depth = 0): string => value.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]+))?\)/g, (_, name: string, fallback?: string) => {
    const found = tokens.get(name);
    if (found !== undefined && depth < 8) return resolve(found, depth + 1);
    if (fallback !== undefined) return fallback.trim();
    throw new Error(`diagram paint: ${name} has no value`);
  });
  const palette = new Map<string, Rgba>();
  for (const [name, value] of tokens) {
    const resolved = resolve(value);
    if (/^(#|rgb|transparent)/.test(resolved)) palette.set(name, parseColor(resolved));
  }
  return palette;
}

export type Palette = ReturnType<typeof diagramPalette>;

type Attributes = Record<string, string | number>;
type Parent = 'node' | 'edge-label' | null;

const TONED = /\btone-([a-z]+)\b/;
const classOf = (tag: string) => / class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];

// What the drawing rules of diagram.css give an element, as presentation
// attributes; `tone` is the nearest tone class on it or around it.
function paintOf(tag: string, classes: string[], tone: string | null, parent: Parent, palette: Palette, theme: Theme): Attributes | null {
  const parentIsNode = parent === 'node';
  const parentIsEdgeLabel = parent === 'edge-label';
  const token = (name: string) => {
    const color = palette.get(name);
    if (!color) throw new Error(`diagram paint: the palette has no ${name}`);
    return color;
  };
  const toneFill = () => token(`--${tone ?? 'slate'}-fill`);
  const toneStroke = () => token(`--${tone ?? 'slate'}-stroke`);
  const fill = (color: Rgba): Attributes => ({ fill: hex(color), 'fill-opacity': opacity(color) });
  const stroke = (color: Rgba): Attributes => ({ stroke: hex(color), 'stroke-opacity': opacity(color) });
  const has = (name: string) => classes.includes(name);
  const mask = token('--mask');

  if (tag.includes('data-graph-role="structural-frame-label-mask"')) {
    return { ...fill(mix(toneStroke(), 0.1, mask)), ...stroke(mix(toneStroke(), 0.38, mask)), 'stroke-width': 0.8, rx: 5 };
  }
  // An edge label's plate is rounder, with a hairline in the lane colour.
  if (has('c-mask')) return parentIsEdgeLabel ? { ...fill(mask), ...stroke(token('--lane-stroke')), 'stroke-width': 0.75, rx: 7 } : { ...fill(mask), stroke: 'none' };
  if (has('c-node')) {
    if (parentIsNode && theme === 'dark') return { ...fill(mix(toneStroke(), 0.13, mask)), ...stroke(mix(toneStroke(), 0.72, mask)), 'stroke-width': 1.25 };
    return { ...fill(toneFill()), ...stroke(toneStroke()), ...(parentIsNode ? { 'stroke-width': 1.25 } : {}) };
  }
  if (has('c-frame')) {
    if (has('frame-dashed')) return { fill: 'none', ...stroke(mix(toneStroke(), 0.58, token('--lane-stroke'))), 'stroke-dasharray': '4 3' };
    return { ...fill(mix(toneStroke(), 0.03, [0, 0, 0, 0])), ...stroke(mix(toneStroke(), 0.42, token('--lane-stroke'))) };
  }
  if (has('c-lane')) return { ...fill(token('--lane-fill')), ...stroke(token('--lane-stroke')), 'stroke-dasharray': '6 6' };
  if (has('c-segment')) return { ...fill(token('--lane-fill')), ...stroke(token('--lane-stroke')), 'stroke-dasharray': '4 3' };
  if (has('c-segment-pill')) return { ...fill(mask), ...stroke(token('--lane-stroke')), 'stroke-width': 0.75 };
  if (has('c-lifeline')) return { fill: 'none', ...stroke(token('--arrow')), 'stroke-dasharray': '3 7' };
  if (has('c-activation')) return { ...fill(mix(toneStroke(), 0.16, mask)), ...stroke(toneStroke()) };
  if (has('c-initial')) return { ...fill(token('--arrow-emphasis')), stroke: 'none' };
  if (has('c-final')) return { fill: 'none', ...stroke(toneStroke()) };
  if (has('c-composite')) return { fill: 'none', ...stroke(token('--arrow')), 'stroke-opacity': 0.55, 'stroke-dasharray': '1.5 3.5', 'stroke-linecap': 'round' };
  if (has('c-junction')) return { ...fill(token('--arrow')), stroke: 'none' };
  if (has('m-return')) return { fill: 'none', ...stroke(token('--arrow')), 'stroke-width': 1.1 };
  const text: Record<string, () => Rgba> = {
    't-primary': () => token('--text'),
    't-muted': () => token('--text-muted'),
    't-dim': () => token('--text-dim'),
    't-tone': toneStroke,
    't-segment': () => token('--text-muted'),
    't-edge-default': () => token('--arrow'),
    't-edge-emphasis': () => token('--arrow-emphasis'),
    't-edge-alert': () => token('--red-stroke'),
    't-edge-dashed': () => token('--gold-stroke'),
    'm-default': () => token('--arrow'),
    'm-emphasis': () => token('--arrow-emphasis'),
    'm-alert': () => token('--red-stroke'),
    'm-dashed': () => token('--gold-stroke'),
  };
  for (const name of classes) if (text[name]) return fill(text[name]());
  const arrows: Record<string, [string, string | null]> = {
    'a-default': ['--arrow', null],
    'a-emphasis': ['--arrow-emphasis', null],
    'a-alert': ['--red-stroke', '5 5'],
    'a-dashed': ['--gold-stroke', '4 4'],
    'a-return': ['--arrow', '3 5'],
  };
  for (const name of classes) {
    if (!arrows[name]) continue;
    const [color, dashes] = arrows[name];
    return { ...stroke(token(color)), fill: 'none', ...(dashes ? { 'stroke-dasharray': dashes } : {}) };
  }
  if (has('semantic-sigil')) {
    return { fill: 'none', ...stroke(toneStroke()), 'stroke-width': 1.35, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.76 };
  }
  if (has('sigil-fill')) return { ...fill(toneStroke()), stroke: 'none' };
  return null;
}

function withAttributes(tag: string, attributes: Attributes) {
  let next = tag;
  for (const [name, value] of Object.entries(attributes)) {
    const pattern = new RegExp(` ${name}="[^"]*"`);
    next = pattern.test(next) ? next.replace(pattern, ` ${name}="${value}"`) : next.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
  }
  return next;
}

export interface PaintOptions {
  theme?: Theme;
  // Show the fine detail (node tags, a label's second line) the expanded
  // view shows; the inline figure hides it.
  expanded?: boolean;
  // Lay the canvas colour under the drawing, as a raster export needs.
  background?: boolean;
  fontFamily?: string;
}

export function paintDiagramSvg(svg: string, palette: Palette, { theme = 'light', expanded = false, background = true, fontFamily = 'Be Vietnam Pro' }: PaintOptions = {}) {
  const tones: (string | null)[] = [];
  const parents: Parent[] = [];
  const mask = palette.get('--mask')!;
  const output = svg.replace(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g, (tag, closing: string, name: string, _rest: string, selfClosing: string) => {
    if (closing) {
      tones.pop();
      parents.pop();
      return tag;
    }
    const classes = classOf(tag);
    const own = classes.map((item) => TONED.exec(item)?.[1]).find(Boolean) ?? null;
    const tone = own ?? tones.at(-1) ?? null;
    let painted = tag.replace(/var\(--mask\)/g, hex(mask));
    const attributes = paintOf(tag, classes, tone, parents.at(-1) ?? null, palette, theme);
    if (attributes) painted = withAttributes(painted, attributes);
    if (!expanded && tag.includes('data-detail="fine"')) painted = withAttributes(painted, { display: 'none' });
    if (name === 'svg') {
      painted = withAttributes(painted, { 'font-family': fontFamily });
      if (background) {
        const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(tag);
        if (box) painted += `<rect width="${box[1]}" height="${box[2]}" fill="${hex(palette.get('--dg-bg')!)}"/>`;
      }
    }
    if (!selfClosing) {
      tones.push(tone);
      parents.push(tag.includes('data-node-id=') ? 'node' : tag.includes('data-edge-label=') ? 'edge-label' : null);
    }
    return painted;
  });
  return output;
}
