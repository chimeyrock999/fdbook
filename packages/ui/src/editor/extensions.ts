import { Extension } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';

// ProseMirror plugins as one TipTap extension, for MdxEditor.Root's
// `extensions` (ui 0.7.0): the root puts them on every live editor it
// builds (the first one, and again after a Source/Visual switch). Root
// takes them once, so they are made with it.
export function pluginsExtension(name: string, plugins: Plugin[]) {
  return Extension.create({ name, addProseMirrorPlugins: () => plugins });
}

// What a plugin tells the UI drawn next to its editor. The plugin is made
// with the editor root, before that UI mounts, so a listener hears the
// last value at once, then every new one.
export function createRelay<T>(initial: T) {
  let last = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => last,
    set: (value: T) => {
      last = value;
      for (const listener of listeners) listener(value);
    },
    listen: (listener: (value: T) => void) => {
      listeners.add(listener);
      listener(last);
      return () => { listeners.delete(listener); };
    },
  };
}
