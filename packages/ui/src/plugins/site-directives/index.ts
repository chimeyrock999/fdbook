import { definePlugin } from '#plugins/plugin.ts';
import { decorateSiteDirectives } from './decorate';
import '#plugins/cards.css';
import '#plugins/picker.css';
import './site-directives.css';

// `::::accordions` and `::youtube` as cards. The site's callout directives
// (`:::example`, `:::caution`, …) are the callout plugin's.
export default definePlugin({ id: 'site-directives', decorate: decorateSiteDirectives });
