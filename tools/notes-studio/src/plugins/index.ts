import { createSyntax, type Syntax } from '@fumadocs-editor/core';
import { buildEditorConfig, type PluginModules } from './registry';

// Every plugin folder under src/plugins/, found at build time.
export const editorConfig = buildEditorConfig(
  import.meta.glob<PluginModules[string]>('./*/index.{ts,tsx}', { eager: true }),
);

let syntax: Syntax | null = null;

// The syntax the editor parses notes with, for code that parses a piece of
// one outside the editor. Made on first use.
export function editorSyntax(): Syntax {
  syntax ??= createSyntax(editorConfig.components, editorConfig.syntax);
  return syntax;
}
