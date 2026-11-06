import { ADMONITION_TYPES } from '@fumadocs-editor/core';
import { admonitionSpec, emptyComponent, fumadocsUiComponents, type ComponentRenderProps, type UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '#plugins/plugin.ts';
import '#plugins/picker.css';
import './callout.css';
import { SiteCallout } from './SiteCallout';
import { CALLOUT_TYPES, DIRECTIVE_TYPES } from './types';

// The editor parses `:::name` as an admonition only when the name is a key of
// ADMONITION_TYPES, a plain object core exports and reads at parse time. The
// site renders more names (`:::example`, `:::caution`, …), so they go in here,
// before any note is parsed. The values are the editor's own colour keys,
// unused once SiteCallout renders. tests/src/plugins/callout.test.ts fails if
// a new editor version stops reading this object.
for (const name of DIRECTIVE_TYPES) ADMONITION_TYPES[name] ??= 'info';

const regions = { title: 'notes-callout-head notes-callout-title studio-callout-title', body: 'notes-callout-body studio-callout-body' };

function withTypes(spec: UiComponentSpec, types: string[]): UiComponentSpec {
  return {
    ...spec,
    regions,
    props: spec.props?.map((prop) => (prop.name === 'type' ? { ...prop, options: types } : prop)),
    render: (props: ComponentRenderProps) => <SiteCallout {...props} types={types} />,
  };
}

const fumadocsCallout = fumadocsUiComponents.find((spec) => spec.name === 'Callout');
if (!fumadocsCallout) throw new Error('fumadocs-editor has no Callout spec');

// `<Callout type="…" title="…">` and `:::type[title]`, drawn like the site.
const calloutSpec = withTypes(fumadocsCallout, CALLOUT_TYPES);
const directiveSpec: UiComponentSpec = {
  ...withTypes(admonitionSpec, DIRECTIVE_TYPES),
  insert: (specs) => emptyComponent(directiveSpec, specs, [{ type: 'mdxJsxAttribute', name: 'type', value: 'note' }]),
};

export default definePlugin({ id: 'callout', components: [calloutSpec, directiveSpec], syntax: { directives: true } });
