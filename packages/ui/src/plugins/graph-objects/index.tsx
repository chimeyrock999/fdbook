import { emptyComponent, type UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '#plugins/plugin.ts';
import { decorateGraphObjects } from './decorate';
import '#plugins/cards.css';
import './graph-objects.css';
import { SectionTitle } from './SectionTitle';

// <SectionTitle as="h3" id="…" displayName="…">Title</SectionTitle>: a
// heading the graph knows. The title edits in place.
const sectionTitleSpec: UiComponentSpec = {
  name: 'SectionTitle',
  label: 'Section title',
  contentRegion: { region: 'title', placeholder: 'Section title…' },
  regions: { title: 'studio-section-title-text' },
  props: [
    { name: 'as', label: 'Level', type: 'enum', options: ['h2', 'h3', 'h4', 'h5', 'h6'], default: 'h3' },
    { name: 'id', label: 'Graph id', type: 'string' },
    { name: 'displayName', label: 'Display name', type: 'string' },
  ],
  render: SectionTitle,
  insert: (specs) => emptyComponent(sectionTitleSpec, specs, [{ type: 'mdxJsxAttribute', name: 'id', value: '' }]),
};

// The graph markup of components/graph-objects.tsx: inline <Keyword>, <Tag>,
// <GraphMeta/> and their directives as decorations, <SectionTitle> as a
// component.
export default definePlugin({ id: 'graph-objects', components: [sectionTitleSpec], decorate: decorateGraphObjects });
