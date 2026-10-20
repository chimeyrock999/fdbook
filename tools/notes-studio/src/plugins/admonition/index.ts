import { admonitionSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '../plugin';

// `:::note`, `:::info`, `:::tip`, `:::warn`, `:::warning`, `:::danger`,
// `:::success`. The site's other directives (`:::example`, `:::caution`,
// `:::accordion`, …) stay as source until the editor can take extra
// directive names.
export default definePlugin({ id: 'admonition', components: [admonitionSpec], syntax: { directives: true } });
