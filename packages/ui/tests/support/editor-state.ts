import { createSyntax, editorExtensions, parseMdxToDoc } from '@fumadocs-editor/core';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Decoration } from '@tiptap/pm/view';
import { editorConfig } from '#plugins/index.ts';

// Notes as the editor holds them: parsed with the plugins' syntax into the
// editor's own ProseMirror schema, so decorators see what they see live.
export const syntax = createSyntax(editorConfig.components, editorConfig.syntax);
export const schema = getSchema(editorExtensions({ components: editorConfig.components }));

export function editorState(source: string): EditorState {
  return EditorState.create({ doc: Node.fromJSON(schema, parseMdxToDoc(source, syntax).doc) });
}

export function withText(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

export function withNode(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
}

// What a decoration does, for assertions: a widget (by its key), or the
// class it puts on a range or node.
export function describeDecoration(decoration: Decoration): { widget?: string; class?: string; from: number; to: number } {
  const { from, to } = decoration;
  const spec = decoration.spec as { key?: string };
  if (spec.key !== undefined) return { widget: spec.key, from, to };
  const attrs = (decoration as unknown as { type: { attrs: Partial<Record<string, string>> } }).type.attrs;
  return { class: attrs.class, from, to };
}

// Every node of a type, with its position.
export function nodesOf(state: EditorState, type: string) {
  const out: { node: Node; pos: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === type) out.push({ node, pos });
  });
  return out;
}

// The value, or a failed test naming what was missing.
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}
