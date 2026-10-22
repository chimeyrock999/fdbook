/**
 * Client-side export of an inline `<svg>` (Mermaid output, or an `.svg` file
 * rendered by `<SvgDiagram>`) so the shared diagram toolbar can offer the same
 * download formats everywhere. Raster formats go through a canvas; `svg` is
 * serialized as-is.
 */

export type DiagramExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

const RASTER_FORMATS: DiagramExportOption[] = [
  { value: 'png', label: 'PNG', hint: 'Lossless image' },
  { value: 'jpeg', label: 'JPEG', hint: 'Compact image' },
  { value: 'webp', label: 'WebP', hint: 'Modern image' },
];
const VECTOR_FORMAT: DiagramExportOption = { value: 'svg', label: 'SVG', hint: 'Editable vector' };

export interface DiagramExportOption {
  value: DiagramExportFormat;
  label: string;
  hint: string;
}

/**
 * What this particular diagram can be exported as, read from its markup.
 *
 * A chart whose labels are HTML inside `<foreignObject>` — Mermaid's default —
 * taints the canvas the raster export draws into, so the browser refuses to
 * read the pixels back. Rather than offering a download that throws, those
 * charts advertise the vector export only.
 */
export function diagramExportFormats(markup?: string): DiagramExportOption[] {
  const rasterizable = markup ? !/<foreignObject[\s>]/i.test(markup) : false;

  return rasterizable ? [...RASTER_FORMATS, VECTOR_FORMAT] : [VECTOR_FORMAT];
}

// Raster exports are drawn at 2x so text stays crisp on hi-dpi screens.
const RASTER_SCALE = 2;
const MIME: Record<DiagramExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const PELE_VARIABLES = [
  ...['bg', 'fg', 'muted', 'line', 'surface', 'surface-alt', 'border', 'accent', 'font', 'font-mono'],
  ...Array.from({ length: 8 }, (_, index) => `series-${index + 1}`),
].map((name) => `--pele-${name}`);
const PELE_LABELS = '.pele-label, .pele-cluster-label';
// The halo behind a lifted subgraph title, recoloured for an author's fill
// (styles/notes-theme.css).
const PELE_TITLE_HALOS = '.pele-cluster-title[data-author-fill] > text:not(.pele-cluster-label)';

export async function exportSvgElement(
  svg: SVGSVGElement,
  format: DiagramExportFormat,
  filename: string,
): Promise<void> {
  const markup = serializeSvg(svg);
  const name = `${slugify(filename) || 'diagram'}.${format === 'jpeg' ? 'jpg' : format}`;

  if (format === 'svg') {
    download(new Blob([markup], { type: MIME.svg }), name);
    return;
  }

  const { height, width } = intrinsicSize(svg);
  const blob = await rasterize(markup, width, height, format);

  if (blob) download(blob, name);
}

/**
 * Clones the element so export-time sizing never touches what is on screen,
 * pins the intrinsic pixel size an inline diagram does not carry, and inlines
 * the computed font stack because the SVG is rendered detached from the page.
 */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { height, width } = intrinsicSize(svg);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.removeProperty('max-width');

  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const style = getComputedStyle(svg);
  clone.style.fontFamily = style.fontFamily;
  clone.style.color = style.color;

  // Pele colours a diagram from CSS variables the page sets; a file on its
  // own would fall back to Pele's light palette.
  for (const name of PELE_VARIABLES) {
    const value = style.getPropertyValue(name).trim();
    if (value) clone.style.setProperty(name, value);
  }

  // Page rules can recolour a label (dark text on an author's fill in the
  // dark theme); the file has no stylesheet, so carry the computed fill over
  // unless the label sets its own.
  const labels = svg.querySelectorAll<SVGElement>(PELE_LABELS);
  const cloneLabels = clone.querySelectorAll<SVGElement>(PELE_LABELS);
  labels.forEach((label, index) => {
    if (label.style.fill) return;
    cloneLabels[index]?.style.setProperty('fill', getComputedStyle(label).fill);
  });
  const halos = svg.querySelectorAll<SVGElement>(PELE_TITLE_HALOS);
  const cloneHalos = clone.querySelectorAll<SVGElement>(PELE_TITLE_HALOS);
  halos.forEach((halo, index) => {
    cloneHalos[index]?.style.setProperty('stroke', getComputedStyle(halo).stroke);
  });

  return new XMLSerializer().serializeToString(clone);
}

function intrinsicSize(svg: SVGSVGElement) {
  const viewBox = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();

  return {
    width: Math.max(1, Math.round(viewBox?.width || rect.width || 1)),
    height: Math.max(1, Math.round(viewBox?.height || rect.height || 1)),
  };
}

function rasterize(markup: string, width: number, height: number, format: DiagramExportFormat) {
  return new Promise<Blob | null>((resolve) => {
    const url = URL.createObjectURL(new Blob([markup], { type: MIME.svg }));
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * RASTER_SCALE;
      canvas.height = height * RASTER_SCALE;

      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }

      // JPEG has no alpha channel, so an unpainted canvas would come out black.
      if (format === 'jpeg') {
        context.fillStyle = readBackground();
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), MIME[format], 0.95);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });
}

function readBackground() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-fd-background').trim();

  return value || '#ffffff';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
