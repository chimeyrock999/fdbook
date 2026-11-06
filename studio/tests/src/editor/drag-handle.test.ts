import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRoot } from '../../../server/config';

// src/editor/drag-handle.css redraws the editor's block handle, found by its
// aria-label because the editor's classes are generated. A new editor
// version that changes the label would bring the red joystick back.
const studio = join(installRoot, 'studio');

describe('block drag handle', () => {
  it('targets the label the installed editor gives its handle', async () => {
    const css = await readFile(join(studio, 'src/editor/drag-handle.css'), 'utf8');
    const labels = new Set([...css.matchAll(/aria-label='([^']+)'/g)].map((match) => match[1]));
    expect([...labels]).toEqual(['Drag to move, click to select']);
    const dist = join(studio, 'node_modules/@fumadocs-editor/ui/dist');
    const sources = await Promise.all((await readdir(dist)).filter((name) => name.endsWith('.js')).map((name) => readFile(join(dist, name), 'utf8')));
    expect(sources.some((source) => source.includes(`"aria-label": "${[...labels][0]}"`))).toBe(true);
  });
});
