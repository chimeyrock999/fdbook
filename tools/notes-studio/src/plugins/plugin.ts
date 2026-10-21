import type { SyntaxOptions, UiComponentSpec } from '@fumadocs-editor/ui';

// A Studio plugin adds what the editor understands: MDX components (parse,
// serialize, render, slash menu, props panel; see UiComponentSpec) and
// parse-level dialects. Each plugin lives in its own folder under
// src/plugins/ with an index.ts(x) whose default export is a plugin; the
// registry finds it there, so adding one needs no other change.
export type StudioPlugin = {
  // Unique; the folder name by convention.
  id: string;
  components?: UiComponentSpec[];
  syntax?: SyntaxOptions;
};

export function definePlugin(plugin: StudioPlugin): StudioPlugin {
  return plugin;
}
