import type { SyntaxOptions, UiComponentSpec } from '@fumadocs-editor/ui';
import type { StudioPlugin } from './plugin';

export type EditorConfig = { plugins: StudioPlugin[]; components: UiComponentSpec[]; syntax: SyntaxOptions };

// Plugin modules as import.meta.glob returns them, keyed by file path.
export type PluginModules = Record<string, { default?: StudioPlugin }>;

// Orders the plugins by path, checks them and merges what they add. A
// dialect is on when any plugin turns it on.
export function buildEditorConfig(modules: PluginModules): EditorConfig {
  const plugins: StudioPlugin[] = [];
  for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    if (!module.default) throw new Error(`${path} has no default export; export definePlugin({ … })`);
    plugins.push(module.default);
  }

  const ids = new Set<string>();
  const owners = new Map<string, string>();
  const components: UiComponentSpec[] = [];
  const syntax: SyntaxOptions = {};
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`Two plugins use the id "${plugin.id}"`);
    ids.add(plugin.id);
    for (const component of plugin.components ?? []) {
      const owner = owners.get(component.name);
      if (owner !== undefined) {
        throw new Error(`Plugins "${owner}" and "${plugin.id}" both define the component <${component.name}>`);
      }
      owners.set(component.name, plugin.id);
      components.push(component);
    }
    for (const [key, value] of Object.entries(plugin.syntax ?? {}) as [keyof SyntaxOptions, boolean | undefined][]) {
      if (value !== undefined) syntax[key] = (syntax[key] ?? false) || value;
    }
  }
  return { plugins, components, syntax };
}
