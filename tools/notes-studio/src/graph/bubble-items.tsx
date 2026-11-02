import type { BubbleItem } from '@fumadocs-editor/ui';
import type { Editor } from '@tiptap/core';
import { Highlighter, Tag } from 'lucide-react';
import { graphCommand } from './graph-plugin';
import { wrapRange } from './markers';

// Keyword and Tag in the editor's own format bubble, as `bubbleItems` of
// `MdxEditor.Root`. They only wrap a text selection, which is when the
// bubble shows, so they are enabled only where `wrapRange` finds one: a
// selection inside an existing marker leaves them off, and the graph bar
// under the bubble edits that marker instead. The bubble is not mounted
// when the editor is read-only. `shortcut` only shows in the tooltip; the
// keys are bound by the graph plugin (`graphKeymap`), which also edits a
// marker at the caret.
function wrapItem(kind: 'Keyword' | 'Tag', icon: BubbleItem['icon'], shortcut: string): BubbleItem {
  return {
    label: kind,
    icon,
    shortcut,
    isEnabled: (editor: Editor) => editor.isEditable && wrapRange(editor.state) !== null,
    run: (editor: Editor) => { graphCommand(kind)(editor.state, editor.view.dispatch, editor.view); },
  };
}

export const graphBubbleItems: BubbleItem[] = [
  wrapItem('Keyword', <Highlighter size={14} aria-hidden />, 'Mod-Alt-k'),
  wrapItem('Tag', <Tag size={14} aria-hidden />, 'Mod-Alt-t'),
];
