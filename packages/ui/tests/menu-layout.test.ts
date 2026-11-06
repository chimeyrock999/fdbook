import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = join(import.meta.dirname, '../src');

const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found`);
  return css.slice(start, css.indexOf('}', start));
};

// The change request menu on a phone (#117): its rows grew the menu's one
// grid column past the panel, badges and dividers drawn outside it.
describe('popup menus on a narrow screen', () => {
  it('keep every row within the menu', async () => {
    const css = await readFile(join(studio, 'index.css'), 'utf8');
    expect(rule(css, '.studio-menu')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('size the change request menu within the viewport', async () => {
    const css = rule(await readFile(join(studio, 'cr/cr.css'), 'utf8'), '.studio-cr-menu');
    expect(css).toMatch(/max-width: min\(300px, calc\(100vw - 16px\)\);/);
    expect(css).toMatch(/min-width: min\(240px, calc\(100vw - 16px\)\);/);
  });
});
