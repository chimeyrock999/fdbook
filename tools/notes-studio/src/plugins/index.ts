import { buildEditorConfig, type PluginModules } from './registry';

// Every plugin folder under src/plugins/, found at build time.
export const editorConfig = buildEditorConfig(
  import.meta.glob<PluginModules[string]>('./*/index.{ts,tsx}', { eager: true }),
);
