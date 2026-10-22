import { createSyntax, type Syntax } from '@fumadocs-editor/core';
import { buildEditorConfig } from './registry';

// Every plugin folder under src/plugins/, found at build time. Untyped:
// vitest 5.0.5 caches a module that calls the typed form on disk, so tests
// would miss a new plugin (vitest-dev/vitest PR 11666).
export const editorConfig = buildEditorConfig(import.meta.glob('./*/index.{ts,tsx}', { eager: true }));

let syntax: Syntax | null = null;

// The syntax the editor parses notes with, for code that parses a piece of
// one outside the editor. Made on first use.
export function editorSyntax(): Syntax {
  syntax ??= createSyntax(editorConfig.components, editorConfig.syntax);
  return syntax;
}
