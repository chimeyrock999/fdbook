// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetChanged } from '#api/asset-versions.ts';
import { Diagram } from '#plugins/diagram/Diagram.tsx';

const SRC = 'data-platform/processing/apache-spark/spark-logic-to-execution';
const PATH = `diagrams/${SRC}.diagram.json`;
// The repository root, from studio/tests/src/plugins.
const real = readFileSync(join(import.meta.dirname, '../../../..', PATH), 'utf8');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The file API answering with `content` for each read, in turn.
function serve(...contents: string[]) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(url);
    const content = contents[Math.min(urls.length - 1, contents.length - 1)];
    return Promise.resolve(new Response(JSON.stringify({ path: PATH, content, mtimeMs: 1 }), { headers: { 'Content-Type': 'application/json' } }));
  });
  return urls;
}

const draw = (props: Record<string, string>) =>
  render(<Diagram props={props} literals={{}} setProp={vi.fn()} setLiteral={vi.fn()} selected={false}>{null}</Diagram>).container;

describe('Diagram card', () => {
  it('draws the diagram file with the site renderer', async () => {
    const urls = serve(real);
    const container = draw({ src: SRC });
    await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
    expect(urls[0]).toBe(`/api/file?path=${encodeURIComponent(PATH)}`);
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(6);
    expect(container.querySelector('.studio-diagram-issues')).toBeNull();
  });

  it('draws again when the file changes on disk', async () => {
    const changed = JSON.parse(real) as { nodes: { label: string }[] };
    changed.nodes[0].label = 'Changed by an agent';
    const urls = serve(real, JSON.stringify(changed));
    const container = draw({ src: SRC });
    await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
    act(() => { assetChanged(PATH, 42); });
    await waitFor(() => { expect(container.textContent).toContain('Changed by an agent'); });
    expect(urls[1]).toBe(`/api/file?path=${encodeURIComponent(PATH)}&v=42`);
  });

  it('says so when the file is gone', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      const gone = urls.length > 1;
      const body = gone ? { error: `no such file: ${PATH}` } : { path: PATH, content: real, mtimeMs: 1 };
      return Promise.resolve(new Response(JSON.stringify(body), { status: gone ? 404 : 200, headers: { 'Content-Type': 'application/json' } }));
    });
    const container = draw({ src: SRC });
    await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
    act(() => { assetChanged(PATH, -7); });
    await waitFor(() => { expect(container.querySelector('.studio-diagram-problem')?.textContent).toBe(`no such file: ${PATH}`); });
  });

  it('says why a diagram does not draw, and counts its issues', async () => {
    const broken = JSON.parse(real) as { edges: { to: string }[] };
    broken.edges[0].to = 'ghost';
    serve(JSON.stringify(broken));
    const container = draw({ src: SRC });
    await waitFor(() => { expect(container.querySelector('.studio-diagram-problem')).not.toBeNull(); });
    expect(container.querySelector('.studio-diagram-problem')?.textContent).toContain('"ghost"');
    expect(container.querySelector('.studio-diagram-issues')?.textContent).toBe('1 issue');
  });

  it('reads nothing without a src', () => {
    const urls = serve(real);
    expect(draw({}).querySelector('.studio-card-src')?.textContent).toBe('no src');
    expect(urls).toEqual([]);
  });
});
