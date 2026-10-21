import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { useEffect, type RefObject } from 'react';
import type { Decorator } from '../plugins/plugin';

const key = new PluginKey('studioDecorations');

// One ProseMirror plugin for every plugin's decorator.
export function decorationsPlugin(decorators: Decorator[]): Plugin {
  return new Plugin({
    key,
    props: {
      decorations: (state) => DecorationSet.create(state.doc, decorators.flatMap((decorate) => decorate(state))),
    },
  });
}

// What the Studio uses of the TipTap editor.
type LiveEditor = {
  isDestroyed: boolean;
  view: { dom: Element };
  registerPlugin: (plugin: Plugin) => unknown;
  unregisterPlugin: (key: PluginKey) => unknown;
};

// MdxEditor.Root takes no extra extensions, so the plugin goes onto the live
// editor itself (it needs a key, to be taken off again). TipTap leaves it on
// its ProseMirror root as `dom.editor`. The Visual surface paints a static
// copy first and swaps the editor in later, and a Source/Visual switch
// replaces it, so this keeps watching.
export function useEditorPlugin(container: RefObject<HTMLElement | null>, plugin: Plugin) {
  useEffect(() => {
    const root = container.current;
    const own = plugin.spec.key;
    if (!root || !own) return;
    let current: LiveEditor | null = null;
    const detach = () => {
      if (current && !current.isDestroyed) current.unregisterPlugin(own);
      current = null;
    };
    const attach = () => {
      // Most mutations are edits inside the editor already decorated.
      if (current && !current.isDestroyed && root.contains(current.view.dom)) return;
      const dom = root.querySelector<HTMLElement & { editor?: LiveEditor }>('.ProseMirror');
      const editor = dom?.editor && !dom.editor.isDestroyed ? dom.editor : null;
      if (editor === current) return;
      detach();
      if (editor) {
        editor.registerPlugin(plugin);
        current = editor;
      }
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [container, plugin]);
}
