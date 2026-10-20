import { fumadocsUiComponents } from '@fumadocs-editor/ui';
import { definePlugin } from '../plugin';

// The fumadocs-ui components the site renders (components/mdx.tsx), with
// their child components. Files, TypeTable, GithubInfo and <include> are left
// out: the site does not render them, so the slash menu must not offer them.
const SITE_COMPONENTS = new Set(['Callout', 'Card', 'Cards', 'Step', 'Steps', 'Accordion', 'Accordions', 'Tab', 'Tabs']);

export default definePlugin({
  id: 'fumadocs-ui',
  components: fumadocsUiComponents.filter((spec) => SITE_COMPONENTS.has(spec.name)),
});
