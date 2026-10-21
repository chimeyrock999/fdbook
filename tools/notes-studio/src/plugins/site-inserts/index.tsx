import type { UiComponentSpec } from '@fumadocs-editor/ui';
import type { JSONContent } from '@tiptap/core';
import { CirclePlay, Heading3, Highlighter, ListCollapse, ListOrdered, PanelTop, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import { definePlugin } from '../plugin';
import { accordions, graphHeading, keyword, steps, tabs, youtube } from './inserts';

// The slash menu offers a component for each spec with an `insert`, and puts
// in whatever that returns. These specs are only for that: they insert the
// site's graph markup and directives (see inserts.ts), never a node of their
// own. No note has a `<studio-insert-…>` tag, so they never parse anything;
// tests/src/plugins/site-inserts.test.ts checks both.
export const INSERT_PREFIX = 'studio-insert-';

// The editor inserts a fragment (an array) as well as a single node.
function insertSpec(name: string, label: string, icon: ReactNode, content: JSONContent | JSONContent[]): UiComponentSpec {
  return {
    name: `${INSERT_PREFIX}${name}`,
    label,
    icon,
    render: () => null,
    insert: () => content,
  };
}

export default definePlugin({
  id: 'site-inserts',
  components: [
    insertSpec('keyword', 'Keyword', <Highlighter size={15} aria-hidden />, keyword('Keyword')),
    insertSpec('tag', 'Tag', <Tag size={15} aria-hidden />, keyword('Tag')),
    insertSpec('graph-heading', 'Graph heading', <Heading3 size={15} aria-hidden />, graphHeading),
    insertSpec('accordions', 'Accordions (directive)', <ListCollapse size={15} aria-hidden />, accordions),
    insertSpec('tabs', 'Tabs (directive)', <PanelTop size={15} aria-hidden />, tabs),
    insertSpec('steps', 'Steps (directive)', <ListOrdered size={15} aria-hidden />, steps),
    insertSpec('youtube', 'YouTube (directive)', <CirclePlay size={15} aria-hidden />, youtube),
  ],
});
