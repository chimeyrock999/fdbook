import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import type { Decorator } from '#plugins/plugin.ts';
import { pluginsExtension } from './extensions';

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

// The plugins' decorations, for MdxEditor.Root's `extensions`.
export const decorationsExtension = (decorators: Decorator[]) => pluginsExtension('studioDecorations', [decorationsPlugin(decorators)]);
