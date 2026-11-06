import type { SyntaxOptions, UiComponentSpec } from '@fumadocs-editor/ui';
import type { EditorState } from '@tiptap/pm/state';
import type { Decoration } from '@tiptap/pm/view';

// Draws a site component over what the editor keeps as source: inline JSX
// tags, text directives and verbatim blocks. It runs on every editor state
// and only changes how the document looks, never the document, so the file
// still round-trips byte for byte.
export type Decorator = (state: EditorState) => Decoration[];

// A Studio plugin adds what the editor understands: MDX components (parse,
// serialize, render, slash menu, props panel; see UiComponentSpec),
// parse-level dialects and decorations. Each plugin lives in its own folder
// under src/plugins/ with an index.ts(x) whose default export is a plugin;
// the registry finds it there, so adding one needs no other change.
export type StudioPlugin = {
  // Unique; the folder name by convention.
  id: string;
  components?: UiComponentSpec[];
  syntax?: SyntaxOptions;
  decorate?: Decorator;
};

export function definePlugin(plugin: StudioPlugin): StudioPlugin {
  return plugin;
}
