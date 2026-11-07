import type { BubbleItem } from '@fumadocs-editor/ui';
import type { Editor } from '@tiptap/core';
import { MessageSquarePlus } from 'lucide-react';
import { useSyncExternalStore } from 'react';

// The block a person asked to comment on from the format bubble, by
// top-level index of the open note (the editor's document holds the note's
// blocks in order, the frontmatter first, as blocksOf finds them). The open
// note's suggestions draw the comment box there (ThreadMarks); one note is
// open at a time, and it clears the draft when it closes.
let draft: number | null = null;
const listeners = new Set<() => void>();

export function setCommentDraft(block: number | null) {
  if (draft === block) return;
  draft = block;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useCommentDraft = () => useSyncExternalStore(subscribe, () => draft);

// Comment in the editor's format bubble: on the block where the selection
// starts. Only where the note takes review threads (a change request) and
// the person may write (the bubble is not mounted read only).
export const commentBubbleItem: BubbleItem = {
  label: 'Comment',
  icon: <MessageSquarePlus size={14} aria-hidden />,
  isActive: () => false,
  isEnabled: (editor: Editor) => editor.isEditable && !editor.state.selection.empty,
  run: (editor: Editor) => { setCommentDraft(editor.state.doc.resolve(editor.state.selection.from).index(0)); },
};
