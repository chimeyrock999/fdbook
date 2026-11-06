// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSvgElement } from '@site/lib/diagram-export';

// jsdom has no canvas or image decoding: record what the export draws, and
// what markup it hands the image.

let calls: string[];
let markup: string;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    void blobs.get(url)?.text().then((text) => {
      markup = text;
      this.onload?.();
    });
  }
}

const blobs = new Map<string, Blob>();

beforeEach(() => {
  calls = [];
  markup = '';
  let next = 0;
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:${String(next++)}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const context = {
    set fillStyle(value: string) {
      calls.push(`fillStyle ${value}`);
    },
    fillRect: () => {
      calls.push('fillRect');
    },
    drawImage: () => {
      calls.push('drawImage');
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => {
    done(new Blob(['x']));
  });
  document.documentElement.style.setProperty('--color-fd-background', 'rgb(19, 31, 25)');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

function mount(svg: string) {
  document.body.innerHTML = svg;
  const element = document.querySelector('svg');
  if (!element) throw new Error('no svg');
  return element;
}

describe('exportSvgElement', () => {
  // A transparent PNG keeps the theme's ink: light text from the dark theme
  // vanishes on a white viewer, dark text from the light theme on a dark one.
  it.each(['png', 'webp', 'jpeg'] as const)('paints the page, then the diagram surface, under a %s', async (format) => {
    const svg = mount('<svg class="pele" viewBox="0 0 10 10" style="--pele-bg: rgb(26, 38, 28)"></svg>');
    await exportSvgElement(svg, format, 'Chart');
    expect(calls).toEqual(['fillStyle rgb(19, 31, 25)', 'fillRect', 'fillStyle rgb(26, 38, 28)', 'fillRect', 'drawImage']);
  });

  // An .svg file drawn by <SvgDiagram> has its own colours.
  it('keeps an svg file transparent in a png, and paints only the page under its jpeg', async () => {
    const svg = mount('<svg viewBox="0 0 10 10"></svg>');
    await exportSvgElement(svg, 'png', 'Chart');
    expect(calls).toEqual(['drawImage']);
    calls = [];
    await exportSvgElement(svg, 'jpeg', 'Chart');
    expect(calls).toEqual(['fillStyle rgb(19, 31, 25)', 'fillRect', 'drawImage']);
  });

  it('leaves an svg export unpainted', async () => {
    const svg = mount('<svg class="pele" viewBox="0 0 10 10" style="--pele-bg: rgb(26, 38, 28)"></svg>');
    await exportSvgElement(svg, 'svg', 'Chart');
    expect(calls).toEqual([]);
  });

  // The dark theme tints an author's subgraph fill through a page rule the
  // file does not carry.
  it('carries the computed strength of an author-filled subgraph', async () => {
    const style = document.createElement('style');
    style.textContent = '.pele-cluster[data-author-fill] > rect { fill-opacity: 0.22; }';
    document.head.append(style);
    const svg = mount(
      '<svg class="pele" viewBox="0 0 10 10"><g class="pele-cluster" data-author-fill=""><rect fill-opacity="0.5" style="fill:#FFF9C4;"/></g>' +
        '<g class="pele-cluster"><rect fill-opacity="0.5"/></g></svg>',
    );
    await exportSvgElement(svg, 'png', 'Chart');
    const rects = new DOMParser().parseFromString(markup, 'text/html').querySelectorAll('rect');
    expect(rects[0].getAttribute('style')).toContain('fill-opacity: 0.22');
    expect(rects[1].getAttribute('style')).toBeNull();
    style.remove();
  });
});
