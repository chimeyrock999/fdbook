import type { BubbleItem } from '@fumadocs-editor/ui';
import type { Editor } from '@tiptap/core';
import { Bean, Nut } from 'lucide-react';
import { graphCommand, takeOff } from './graph-plugin';
import { markerAt, wrapRange } from './markers';

// Keyword and Tag in the editor's own format bubble, as `bubbleItems` of
// `MdxEditor.Root`. Like Bold, each toggles: it wraps a plain text
// selection, and with the selection inside a marker of its kind it shows
// pressed and takes that marker off, keeping its text (or opens its fields
// when the frontmatter lists its id, see takeOff). Elsewhere inside a
// marker it is off. The bubble is not mounted when the editor is
// read-only. `shortcut` only shows in the tooltip; the keys are bound by
// the graph plugin's keydown handler (`keys` in graph-plugin.ts), which
// opens a marker's fields instead.
function toggleItem(kind: 'Keyword' | 'Tag', icon: BubbleItem['icon'], shortcut: string): BubbleItem {
  const around = (editor: Editor) => {
    const marker = markerAt(editor.state);
    return marker?.kind === kind ? marker : null;
  };
  return {
    label: kind,
    icon,
    shortcut,
    isActive: (editor) => around(editor) !== null,
    isEnabled: (editor) => editor.isEditable && (around(editor) !== null || wrapRange(editor.state) !== null),
    run: (editor) => {
      const marker = around(editor);
      if (marker) takeOff(marker)(editor.state, editor.view.dispatch, editor.view);
      else graphCommand(kind)(editor.state, editor.view.dispatch, editor.view);
    },
  };
}

// In the graph colour, apart from the formatting buttons.
export const graphBubbleItems: BubbleItem[] = [
  toggleItem('Keyword', <Nut size={14} className="studio-graph-icon" aria-hidden />, 'Mod-Alt-k'),
  toggleItem('Tag', <Bean size={14} className="studio-graph-icon" aria-hidden />, 'Mod-Alt-t'),
];
