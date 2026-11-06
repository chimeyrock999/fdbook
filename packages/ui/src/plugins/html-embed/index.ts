import { emptyComponent, type UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '#plugins/plugin.ts';
import '#plugins/cards.css';
import './embed.css';
import { HtmlEmbed } from './HtmlEmbed';
import { ASSETS_DIR, siteUrlOf } from '@fdbook/shared/asset-types.ts';

// <HtmlEmbed src="/notes/….html?embed=1" title="…" caption="…" /> from
// components/mdx/html-embed.tsx. Title and caption edit in place; src and
// height sit in the props panel.
const htmlEmbedSpec: UiComponentSpec = {
  name: 'HtmlEmbed',
  label: 'HTML embed',
  attributeRegions: [
    { attribute: 'title', region: 'title', placeholder: 'Title…' },
    { attribute: 'caption', region: 'caption', placeholder: 'Caption…' },
  ],
  regions: { title: 'studio-embed-title', caption: 'studio-embed-caption' },
  props: [
    { name: 'src', label: 'Source', type: 'string', placeholder: `${siteUrlOf(ASSETS_DIR)}/…/page.html?embed=1` },
    { name: 'height', label: 'Height', type: 'string', placeholder: '480' },
  ],
  render: HtmlEmbed,
  insert: (specs) => emptyComponent(htmlEmbedSpec, specs, [{ type: 'mdxJsxAttribute', name: 'src', value: '' }]),
};

export default definePlugin({ id: 'html-embed', components: [htmlEmbedSpec] });
