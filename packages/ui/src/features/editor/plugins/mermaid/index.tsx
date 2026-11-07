import type { UiComponentSpec } from '@fumadocs-editor/ui';
import { Workflow } from 'lucide-react';
import { definePlugin } from '#features/editor/plugins/plugin.ts';
import { mermaid } from './inserts';

// The slash menu offers a component for each spec with an `insert`, and puts
// in whatever that returns. This spec is only for that: it inserts a Mermaid
// code block (see inserts.ts), never a node of its own. No note has a
// `<studio-insert-…>` tag, so it never parses anything;
// tests/features/editor/plugins/mermaid.test.ts checks both.
export const INSERT_PREFIX = 'studio-insert-';

const mermaidSpec: UiComponentSpec = {
  name: `${INSERT_PREFIX}mermaid`,
  // "Diagram" in the label: the menu matches the query against labels only.
  label: 'Mermaid diagram',
  icon: <Workflow size={15} aria-hidden />,
  render: () => null,
  insert: () => mermaid,
};

export default definePlugin({ id: 'mermaid', components: [mermaidSpec] });
