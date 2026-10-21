import { admonitionSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '../plugin';

// `:::note`, `:::info`, `:::tip`, `:::warn`, `:::warning`, `:::danger`,
// `:::success`. The site's own directives (`:::example`, `:::caution`,
// `:::accordion`, …) stay as source for now; the Studio supports them on
// its side in #35.
export default definePlugin({ id: 'admonition', components: [admonitionSpec], syntax: { directives: true } });
