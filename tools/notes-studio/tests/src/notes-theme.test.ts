import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../server/config';

// src/notes-theme.css copies the site's notes palette onto --fde-* tokens.
// Each copied value must still be the site's.
const MAP: Record<string, string> = {
  background: '--color-fd-background',
  foreground: '--color-fd-foreground',
  muted: '--color-fd-muted',
  'muted-foreground': '--color-fd-muted-foreground',
  popover: '--color-fd-popover',
  'popover-foreground': '--color-fd-popover-foreground',
  card: '--color-fd-card',
  'card-foreground': '--color-fd-card-foreground',
  border: '--color-fd-border',
  primary: '--color-fd-primary',
  'primary-foreground': '--color-fd-primary-foreground',
  secondary: '--color-fd-secondary',
  'secondary-foreground': '--color-fd-secondary-foreground',
  accent: '--color-fd-accent',
  'accent-foreground': '--color-fd-accent-foreground',
  ring: '--color-fd-ring',
  info: '--color-callout-info',
  idea: '--color-callout-idea',
  warning: '--color-callout-warning',
  error: '--color-callout-error',
  success: '--color-callout-success',
};

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found`);
  return css.slice(start, css.indexOf('}', start));
}

function values(css: string) {
  return Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

async function themes() {
  const site = await readFile(join(repoRoot, 'app/notes/notes.css'), 'utf8');
  const studio = await readFile(join(repoRoot, 'tools/notes-studio/src/notes-theme.css'), 'utf8');
  return [
    [values(block(site, '\n.notes-theme')), values(block(studio, '\n:root'))],
    [values(block(site, '.dark .notes-theme')), values(block(studio, ':root:not(.light):not(.dark)'))],
  ] as const;
}

describe('notes theme', () => {
  it('matches the site palette in light and dark', async () => {
    const pairs = await themes();
    for (const [siteValues, studioValues] of pairs) {
      for (const [token, siteToken] of Object.entries(MAP)) {
        expect(studioValues[`--fde-${token}`], token).toBe(siteValues[siteToken]);
      }
    }
  });

  // The component plugins (callout, graph objects, accordions, cards) draw
  // with these site tokens under their own names.
  it('copies the site tokens the component plugins use', async () => {
    for (const [siteValues, studioValues] of await themes()) {
      const copied = Object.entries(siteValues).filter(([name]) => /^--(garden|color-graph|color-callout)-/.test(name));
      expect(copied.length).toBeGreaterThan(40);
      for (const [name, value] of copied) expect(studioValues[name], name).toBe(value);
    }
  });
});
