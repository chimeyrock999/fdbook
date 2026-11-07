import { fumadocsUiComponents } from '@fumadocs-editor/ui';
import { definePlugin } from '#features/editor/plugins/plugin.ts';

// fumadocs-ui's MDX components with their child components, as a site made
// with create-fumadocs-app renders them. Files, TypeTable, GithubInfo and
// <include> are left out: the editor cannot draw them live, so the slash
// menu must not offer them.
const COMPONENTS = new Set(['Callout', 'Card', 'Cards', 'Step', 'Steps', 'Accordion', 'Accordions', 'Tab', 'Tabs']);

export default definePlugin({
  id: 'fumadocs-ui',
  components: fumadocsUiComponents.filter((spec) => COMPONENTS.has(spec.name)),
});
