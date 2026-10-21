import { editorExtensions, parseMdxToDoc } from '@fumadocs-editor/core';
import { Editor } from '@tiptap/core';
import { editorConfig } from '../../src/plugins';
import { syntax } from './editor-state';

// A live editor as the Visual surface mounts one: TipTap leaves itself on the
// ProseMirror root as `dom.editor`.
export function mountEditor(container: HTMLElement, source: string) {
  const element = document.createElement('div');
  container.append(element);
  return new Editor({
    element,
    extensions: editorExtensions({ components: editorConfig.components }),
    content: parseMdxToDoc(source, syntax).doc,
  });
}
