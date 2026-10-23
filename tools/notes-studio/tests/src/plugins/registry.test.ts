import type { UiComponentSpec } from '@fumadocs-editor/ui';
import { describe, expect, it } from 'vitest';
import { editorConfig } from '../../../src/plugins';
import { definePlugin } from '../../../src/plugins/plugin';
import { buildEditorConfig } from '../../../src/plugins/registry';

const spec = (name: string) => ({ name, render: () => null }) as UiComponentSpec;

describe('plugin registry', () => {
  it('finds every plugin folder', () => {
    expect(editorConfig.plugins.map((plugin) => plugin.id)).toEqual([
      'callout', 'diagram', 'fumadocs-ui', 'graph-objects', 'html-embed', 'site-directives', 'site-inserts', 'svg-diagram', 'youtube',
    ]);
    expect(editorConfig.syntax).toEqual({ directives: true });
    expect(editorConfig.decorators).toHaveLength(2);
    const names = editorConfig.components.map((component) => component.name);
    expect(names).toEqual(expect.arrayContaining([':::', 'Callout', 'Steps', 'Tabs', 'Diagram', 'HtmlEmbed', 'SvgDiagram', 'SectionTitle', 'YouTube']));
    expect(names).not.toContain('TypeTable');
  });

  it('merges plugins in path order and turns a dialect on when any plugin does', () => {
    const decorateA = () => [];
    const decorateB = () => [];
    const config = buildEditorConfig({
      './b/index.ts': { default: definePlugin({ id: 'b', components: [spec('B')], syntax: { math: false }, decorate: decorateB }) },
      './a/index.ts': { default: definePlugin({ id: 'a', components: [spec('A')], syntax: { math: true }, decorate: decorateA }) },
      './c/index.ts': { default: definePlugin({ id: 'c' }) },
    });
    expect(config.components.map((component) => component.name)).toEqual(['A', 'B']);
    expect(config.syntax).toEqual({ math: true });
    expect(config.decorators).toEqual([decorateA, decorateB]);
  });

  it('refuses duplicate ids, duplicate components and a missing default export', () => {
    expect(() =>
      buildEditorConfig({
        './a/index.ts': { default: definePlugin({ id: 'same' }) },
        './b/index.ts': { default: definePlugin({ id: 'same' }) },
      }),
    ).toThrow(/id "same"/);
    expect(() =>
      buildEditorConfig({
        './a/index.ts': { default: definePlugin({ id: 'a', components: [spec('Box')] }) },
        './b/index.ts': { default: definePlugin({ id: 'b', components: [spec('Box')] }) },
      }),
    ).toThrow(/"a" and "b" both define the component <Box>/);
    expect(() => buildEditorConfig({ './a/index.ts': {} })).toThrow(/no default export/);
  });
});
