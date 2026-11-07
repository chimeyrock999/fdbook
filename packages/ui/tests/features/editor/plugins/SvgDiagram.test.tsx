// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SvgDiagram } from '#features/editor/plugins/svg-diagram/SvgDiagram.tsx';
import { defined } from '#tests/support/editor-state.ts';

afterEach(cleanup);

const draw = (props: Record<string, string>) =>
  render(<SvgDiagram props={props} literals={{}} setProp={vi.fn()} setLiteral={vi.fn()} selected={false}>{null}</SvgDiagram>).container;

describe('SvgDiagram', () => {
  it('shows the SVG from the file API with the site options', () => {
    const container = draw({ src: '/docs/guide/narrow.svg', label: 'Narrow', maxWidth: '480px', invertOnDark: 'yes' });
    const image = defined(container.querySelector('img'));
    expect(image.getAttribute('src')).toBe('/api/file?path=public%2Fdocs%2Fguide%2Fnarrow.svg');
    expect(image.alt).toBe('Narrow');
    expect(image.style.maxWidth).toBe('480px');
    expect(container.querySelector('[data-invert]')).not.toBeNull();
    const plated = draw({ src: 'docs/x.svg', plate: '1', invertOnDark: 'true' });
    expect(plated.querySelector('[data-invert]')).toBeNull();
    expect(plated.querySelector('[data-plate]')).not.toBeNull();
    expect(draw({ src: '/docs/x.svg', plate: 'no' }).querySelector('[data-plate]')).toBeNull();
  });

  // The site reads `svg ?? readPublicAsset(src)`: inline markup wins.
  it('shows inline svg first, as the site does', () => {
    const container = draw({ svg: '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', src: '/docs/other.svg' });
    const image = defined(container.querySelector('img'));
    expect(image.getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')}`);
    expect(container.querySelector('.studio-card-src')?.textContent).toBe('inline svg');
  });

  it('says so when the file API cannot show it', () => {
    expect(draw({ src: '/images/x.svg' }).textContent).toContain('Not a file under public/docs/');

  });
});
