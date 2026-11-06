import { emptyComponent, type UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '#features/editor/plugins/plugin.ts';
import '#features/editor/plugins/cards.css';
import '#features/editor/plugins/html-embed/embed.css';
import { Diagram } from './Diagram';

// <Diagram src="…/name" caption="…" /> from components/mdx/diagram.tsx: a
// `.diagram.json` under diagrams/, drawn when the site builds. The caption
// edits in place; src and title sit in the props panel.
const diagramSpec: UiComponentSpec = {
  name: 'Diagram',
  label: 'Diagram',
  attributeRegions: [{ attribute: 'caption', region: 'caption', placeholder: 'Caption…' }],
  regions: { caption: 'studio-embed-caption' },
  props: [
    { name: 'src', label: 'Source', type: 'string', placeholder: 'data-platform/…/name' },
    { name: 'title', label: 'Title', type: 'string' },
  ],
  render: Diagram,
  insert: (specs) => emptyComponent(diagramSpec, specs, [{ type: 'mdxJsxAttribute', name: 'src', value: '' }]),
};

export default definePlugin({ id: 'diagram', components: [diagramSpec] });
