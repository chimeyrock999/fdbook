import { emptyComponent, type UiComponentSpec } from '@fumadocs-editor/ui';
import { CirclePlay } from 'lucide-react';
import { definePlugin } from '#plugins/plugin.ts';
import '#plugins/cards.css';
import '#plugins/html-embed/embed.css';
import '#plugins/site-directives/site-directives.css';
import { YouTube } from './YouTube';

// <YouTube url="…" title="…" /> from components/mdx/youtube.tsx. The title
// edits in place; url and videoId sit in the props panel.
const youtubeSpec: UiComponentSpec = {
  name: 'YouTube',
  label: 'YouTube',
  icon: <CirclePlay size={15} aria-hidden />,
  attributeRegions: [{ attribute: 'title', region: 'title', placeholder: 'Title…' }],
  regions: { title: 'studio-embed-title' },
  props: [
    { name: 'url', label: 'URL', type: 'string', placeholder: 'https://youtu.be/…' },
    { name: 'videoId', label: 'Video id', type: 'string' },
  ],
  render: YouTube,
  insert: (specs) => emptyComponent(youtubeSpec, specs, [{ type: 'mdxJsxAttribute', name: 'url', value: '' }]),
};

export default definePlugin({ id: 'youtube', components: [youtubeSpec] });
