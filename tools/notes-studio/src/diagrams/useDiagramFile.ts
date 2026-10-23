import { formatDiagramJson } from '@site/lib/diagram/format';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssetUrl } from '../api/asset-versions';
import { FileConflictError, type createFilesClient } from '../api/files';
import type { Input } from './edits';

type Files = ReturnType<typeof createFilesClient>;

// `invalid`: the JSON being typed does not parse, so it is not saved;
// `conflict`: the file changed on disk while this page had edits not saved.
export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'invalid' | 'conflict' | 'failed';

type State = {
  doc: Input | null;
  text: string;
  past: Input[];
  future: Input[];
  status: SaveStatus;
  error: string | null;
  // The text the disk holds, as far as this page knows; null before it was read.
  onDisk: string | null;
  // What the disk holds after a change made elsewhere, in `conflict`; a
  // null content: the file is gone (or could not be read).
  disk: { content: string | null; mtimeMs: number | null } | null;
};

const SAVE_MS = 400;
// JSON typed within this long is one undo step.
const TYPING_MS = 1000;
const HISTORY = 200;

const EMPTY: State = { doc: null, text: '', past: [], future: [], status: 'loading', error: null, onDisk: null, disk: null };

// Edits a page left before they were on disk (a conflict, JSON that did not
// parse, a save still under way), by file client (one worktree) and path,
// for the next page that opens the file in this tab: it shows them again,
// saved or in conflict.
type Left = Map<string, { text: string; base: number | null }>;
const leftBy = new WeakMap<Files, Left>();
function leftIn(files: Files): Left {
  const known = leftBy.get(files);
  if (known) return known;
  const left: Left = new Map();
  leftBy.set(files, left);
  return left;
}

function parsed(text: string): Input | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Input) : null;
  } catch {
    return null;
  }
}

// One `.diagram.json` open for editing: read through the file API, changed
// as a parsed document (`apply`, from the canvas and the panel) or as text
// (`setText`, the JSON view), with undo and redo, and saved a moment after
// each change with the mtime it was read at, as notes are. A change on disk
// (an agent, the CLI) loads while nothing is waiting to be saved; with
// edits waiting it is a conflict the page resolves (`resolve`).
export function useDiagramFile(files: Files, path: string, readOnly: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const left = leftIn(files);
  const url = useAssetUrl(path);
  // The mtime the next write is based on; null writes a new file. `known`:
  // the file was read once, so writing makes sense.
  const base = useRef<number | null>(null);
  const known = useRef(false);
  // The text the disk holds, as far as this page knows, and the text a
  // write under way sends.
  const saved = useRef<string | null>(null);
  const sending = useRef<string | null>(null);
  const latest = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  const typedAt = useRef(0);
  useLayoutEffect(() => { latest.current = state; });

  const update = useCallback((change: (current: State) => State) => {
    setState((current) => {
      const next = change(current);
      latest.current = next;
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || readOnly) return;
    const { text, status } = latest.current;
    if (status !== 'unsaved' || !known.current) return;
    saving.current = true;
    sending.current = text;
    update((current) => ({ ...current, status: 'saving' }));
    try {
      base.current = await files.writeFile(path, text, base.current);
      saved.current = text;
      if (left.get(path)?.text === text) left.delete(path);
      update((current) => ({ ...current, onDisk: text, status: current.text === text ? 'saved' : 'unsaved' }));
    } catch (error) {
      if (error instanceof FileConflictError) {
        update((current) => ({ ...current, status: 'conflict', disk: error.disk ?? { content: null, mtimeMs: null } }));
      } else update((current) => ({ ...current, status: 'failed', error: (error as Error).message }));
    } finally {
      saving.current = false;
      sending.current = null;
    }
    if (latest.current.status === 'unsaved') timer.current = setTimeout(() => { void save(); }, SAVE_MS);
  }, [files, path, readOnly, update]);

  const later = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, SAVE_MS);
  }, [save]);

  // The file as the disk has it, from the first read or a change elsewhere.
  const loaded = useCallback((content: string, mtimeMs: number, keepHistory: boolean) => {
    base.current = mtimeMs;
    known.current = true;
    saved.current = content;
    const doc = parsed(content);
    update((current) => ({
      doc: doc ?? current.doc,
      text: content,
      past: keepHistory && current.doc ? [...current.past, current.doc].slice(-HISTORY) : [],
      future: [],
      status: doc ? 'saved' : 'invalid',
      error: null,
      onDisk: content,
      disk: null,
    }));
  }, [update]);

  // Edits an earlier page left for this file: on the disk's version they
  // were made from, they wait to be saved; on another, they are a conflict.
  const restore = useCallback((kept: { text: string; base: number | null }, content: string, mtimeMs: number) => {
    const doc = parsed(kept.text);
    const conflict = kept.base !== mtimeMs;
    update((current) => ({
      ...current,
      doc: doc ?? current.doc,
      text: kept.text,
      status: conflict ? 'conflict' : doc ? 'unsaved' : 'invalid',
      disk: conflict ? { content, mtimeMs } : null,
    }));
  }, [update]);

  useEffect(() => {
    let current = true;
    files.readFile(path).then(
      ({ content, mtimeMs }) => {
        if (!current || mtimeMs === base.current) return;
        // The write under way, heard before its answer: that answer brings the mtime.
        if (content === sending.current) return;
        // The text this page holds already, under a new mtime.
        if (known.current && (content === saved.current || content === latest.current.text)) {
          base.current = mtimeMs;
          saved.current = content;
          update((state) => ({ ...state, onDisk: content }));
          return;
        }
        const first = !known.current;
        const kept = first ? left.get(path) : undefined;
        if (kept) {
          left.delete(path);
          loaded(content, mtimeMs, false);
          if (kept.text !== content) {
            restore(kept, content, mtimeMs);
            later();
          }
        } else if (first || latest.current.text === saved.current) loaded(content, mtimeMs, !first);
        else update((state) => ({ ...state, status: 'conflict', disk: { content, mtimeMs } }));
      },
      (error: unknown) => {
        if (!current) return;
        if (!known.current) update((state) => ({ ...state, status: 'failed', error: (error as Error).message }));
        // Read before and not now: deleted, most likely. Keep mine writes it again.
        else update((state) => ({ ...state, status: 'conflict', disk: { content: null, mtimeMs: null } }));
      },
    );
    return () => { current = false; };
  }, [files, path, url, loaded, restore, later, update]);

  // Leaving the page saves what is waiting, and keeps what is not on disk
  // yet for the next page that opens the file.
  const leave = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    leave.current = () => {
      const { text, onDisk, status } = latest.current;
      if (onDisk !== null && text !== onDisk) left.set(path, { text, base: base.current });
      if (status === 'unsaved') void save();
    };
  });
  useEffect(() => () => { leave.current(); }, []);

  // A new document from the canvas or the panel: one undo step.
  const apply = useCallback((next: Input) => {
    if (readOnly) return;
    typedAt.current = 0;
    update((current) => ({
      ...current,
      doc: next,
      text: formatDiagramJson(next),
      past: current.doc ? [...current.past, current.doc].slice(-HISTORY) : current.past,
      future: [],
      status: current.status === 'conflict' ? 'conflict' : 'unsaved',
    }));
    later();
  }, [readOnly, later, update]);

  // The JSON view's text: saved as typed once it parses.
  const setText = useCallback((text: string) => {
    if (readOnly) return;
    const doc = parsed(text);
    const now = Date.now();
    const typing = now - typedAt.current < TYPING_MS;
    typedAt.current = now;
    update((current) => {
      const conflict = current.status === 'conflict';
      if (!doc) return { ...current, text, status: conflict ? 'conflict' : 'invalid' };
      const past = !typing && current.doc ? [...current.past, current.doc].slice(-HISTORY) : current.past;
      return { ...current, doc, text, past, future: [], status: conflict ? 'conflict' : 'unsaved' };
    });
    if (doc) later();
  }, [readOnly, later, update]);

  const step = useCallback((back: boolean) => {
    if (readOnly) return;
    typedAt.current = 0;
    const { past, future, doc } = latest.current;
    const stack = back ? past : future;
    const to = stack.at(-1);
    if (!to || !doc) return;
    update((current) => ({
      ...current,
      doc: to,
      text: formatDiagramJson(to),
      past: back ? current.past.slice(0, -1) : [...current.past, doc],
      future: back ? [...current.future, doc] : current.future.slice(0, -1),
      status: current.status === 'conflict' ? 'conflict' : 'unsaved',
    }));
    later();
  }, [readOnly, later, update]);

  // After a conflict: load what the disk has (`disk`), or write this page's
  // version over it (`mine`).
  const resolve = useCallback((choice: 'disk' | 'mine') => {
    const { disk } = latest.current;
    if (!disk) return;
    if (choice === 'disk') {
      if (disk.content !== null && disk.mtimeMs !== null) loaded(disk.content, disk.mtimeMs, true);
      return;
    }
    base.current = disk.mtimeMs;
    update((current) => ({ ...current, status: parsed(current.text) ? 'unsaved' : 'invalid', disk: null }));
    later();
  }, [loaded, later, update]);

  return {
    ...state,
    // Edits not on disk yet: the App waits for them as for a note's.
    waiting: state.onDisk !== null && state.text !== state.onDisk,
    canUndo: state.past.length > 0 && !readOnly,
    canRedo: state.future.length > 0 && !readOnly,
    apply,
    setText,
    undo: useCallback(() => { step(true); }, [step]),
    redo: useCallback(() => { step(false); }, [step]),
    resolve,
  };
}
