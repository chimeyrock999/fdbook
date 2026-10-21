// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SvgDiagram } from '../../../src/plugins/svg-diagram/SvgDiagram';
import { defined } from '../../support/editor-state';

afterEach(cleanup);

const draw = (props: Record<string, string>) =>
  render(<SvgDiagram props={props} literals={{}} setProp={vi.fn()} setLiteral={vi.fn()} selected={false}>{null}</SvgDiagram>).container;

describe('SvgDiagram', () => {
  it('shows the SVG from the file API with the site options', () => {
    const container = draw({ src: '/notes/spark/narrow.svg', label: 'Narrow', maxWidth: '480px', invertOnDark: 'yes' });
    const image = defined(container.querySelector('img'));
    expect(image.getAttribute('src')).toBe('/api/file?path=public%2Fnotes%2Fspark%2Fnarrow.svg');
    expect(image.alt).toBe('Narrow');
    expect(image.style.maxWidth).toBe('480px');
    expect(container.querySelector('[data-invert]')).not.toBeNull();
    const plated = draw({ src: 'notes/x.svg', plate: '1', invertOnDark: 'true' });
    expect(plated.querySelector('[data-invert]')).toBeNull();
    expect(plated.querySelector('[data-plate]')).not.toBeNull();
    expect(draw({ src: '/notes/x.svg', plate: 'no' }).querySelector('[data-plate]')).toBeNull();
  });

  it('says so when the file API cannot show it', () => {
    expect(draw({ src: '/images/x.svg' }).textContent).toContain('Not a file under public/notes/');
    expect(draw({ svg: '<svg />' }).textContent).toContain('Inline SVG: shown on the site');
  });
});
