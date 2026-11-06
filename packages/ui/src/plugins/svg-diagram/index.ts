import { emptyComponent, type UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '#plugins/plugin.ts';
import '#plugins/cards.css';
import '#plugins/html-embed/embed.css';
import './svg-diagram.css';
import { SvgDiagram } from './SvgDiagram';
import { ASSETS_DIR, siteUrlOf } from '@fdbook/shared/asset-types.ts';

// <SvgDiagram src="/notes/….svg" label="…" caption="…" /> from
// components/mdx/svg-diagram.tsx. The caption edits in place; the rest sit in
// the props panel.
const svgDiagramSpec: UiComponentSpec = {
  name: 'SvgDiagram',
  label: 'SVG diagram',
  attributeRegions: [{ attribute: 'caption', region: 'caption', placeholder: 'Caption…' }],
  regions: { caption: 'studio-embed-caption' },
  props: [
    { name: 'src', label: 'Source', type: 'string', placeholder: `${siteUrlOf(ASSETS_DIR)}/…/diagram.svg` },
    { name: 'svg', label: 'Inline SVG', type: 'string' },
    { name: 'label', label: 'Label', type: 'string' },
    { name: 'maxWidth', label: 'Max width', type: 'string', placeholder: '720' },
    { name: 'invertOnDark', label: 'Invert on dark', type: 'boolean' },
    { name: 'plate', label: 'Light plate', type: 'boolean' },
    { name: 'zoom', label: 'Zoom', type: 'boolean' },
  ],
  render: SvgDiagram,
  insert: (specs) => emptyComponent(svgDiagramSpec, specs, [{ type: 'mdxJsxAttribute', name: 'src', value: '' }]),
};

export default definePlugin({ id: 'svg-diagram', components: [svgDiagramSpec] });
