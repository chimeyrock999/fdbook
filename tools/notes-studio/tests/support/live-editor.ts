import { editorExtensions, parseMdxToDoc } from '@fumadocs-editor/core';
import { Editor, type AnyExtension } from '@tiptap/core';
import { editorConfig } from '../../src/plugins';
import { syntax } from './editor-state';

// A live editor as the Visual surface mounts one: TipTap leaves itself on the
// ProseMirror root as `dom.editor`.
// `extensions` go on it as MdxEditor.Root's `extensions` would.
export function mountEditor(container: HTMLElement, source: string, extensions: AnyExtension[] = []) {
  const element = document.createElement('div');
  container.append(element);
  return new Editor({
    element,
    extensions: [...editorExtensions({ components: editorConfig.components }), ...extensions],
    content: parseMdxToDoc(source, syntax).doc,
  });
}
