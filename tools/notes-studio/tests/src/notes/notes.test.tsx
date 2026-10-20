// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteGate } from '../../../src/notes/NoteGate';
import { NoteList } from '../../../src/notes/NoteList';
import type { createFilesClient } from '../../../src/api/files';
import { applyFileEvent, filterNotes, loadNotes, noteFromUrl, syncPath } from '../../../src/notes/notes';

const notes = [
  { path: 'content/notes/streaming/index.mdx', title: 'Streaming' },
  { path: 'content/notes/database/wal.mdx', title: 'WAL and fsync' },
];

afterEach(cleanup);

describe('note helpers', () => {
  it('maps paths and reads ?path=', () => {
    expect(syncPath('content/notes/streaming/index.mdx')).toBe('streaming/index.mdx');
    expect(noteFromUrl('?path=content%2Fnotes%2Fa.mdx')).toBe('content/notes/a.mdx');
    expect(noteFromUrl('?path=content/notes/meta.yaml')).toBeNull();
    expect(noteFromUrl('?path=package.json')).toBeNull();
    expect(noteFromUrl('')).toBeNull();
  });

  it('filters by title or path, ignoring case', () => {
    expect(filterNotes(notes, 'wal').map((note) => note.title)).toEqual(['WAL and fsync']);
    expect(filterNotes(notes, 'STREAMING/').map((note) => note.title)).toEqual(['Streaming']);
    expect(filterNotes(notes, '  ')).toBe(notes);
  });
});

// A files client over an in-memory map of worktree paths to contents.
function fakeFiles(contents: Record<string, string>) {
  return {
    listFiles: () =>
      Promise.resolve(Object.keys(contents).map((path) => ({ path, kind: path.endsWith('.mdx') ? 'note' : 'meta', mtimeMs: 1 }))),
    readFile: (path: string) => {
      return path in contents
        ? Promise.resolve({ path, content: contents[path], mtimeMs: 1 })
        : Promise.reject(new Error('gone'));
    },
  } as unknown as ReturnType<typeof createFilesClient>;
}

describe('loading the list', () => {
  it('reads titles like the form does and falls back to the file name', async () => {
    const files = fakeFiles({
      'content/notes/b/index.mdx': '---\ntitle: >-\n  Folded\n  title\n---\n',
      'content/notes/a.mdx': '---\ntitle: "A \\"quoted\\" word"\n---\n',
      'content/notes/c/no-title.mdx': '# body\n',
      'content/notes/meta.yaml': 'pages: []\n',
    });
    expect(await loadNotes(files)).toEqual([
      { path: 'content/notes/a.mdx', title: 'A "quoted" word' },
      { path: 'content/notes/b/index.mdx', title: 'Folded title' },
      { path: 'content/notes/c/no-title.mdx', title: 'no-title' },
    ]);
  });

  it('follows added, changed and removed notes', async () => {
    const contents: Record<string, string> = { 'content/notes/new.mdx': '---\ntitle: New\n---\n' };
    const files = fakeFiles(contents);
    let list = await applyFileEvent(files, notes, { type: 'add', path: 'content/notes/new.mdx', mtimeMs: 2 });
    expect(list.map((note) => note.title)).toEqual(['WAL and fsync', 'New', 'Streaming']);
    contents['content/notes/new.mdx'] = '---\ntitle: Renamed\n---\n';
    list = await applyFileEvent(files, list, { type: 'change', path: 'content/notes/new.mdx', mtimeMs: 3 });
    expect(list.map((note) => note.title)).toEqual(['WAL and fsync', 'Renamed', 'Streaming']);
    list = await applyFileEvent(files, list, { type: 'unlink', path: 'content/notes/new.mdx', mtimeMs: null });
    expect(list).toEqual([notes[1], notes[0]]);
    expect(await applyFileEvent(files, notes, { type: 'change', path: 'content/notes/meta.yaml', mtimeMs: 4 })).toBe(notes);
  });
});

describe('NoteList', () => {
  it('marks the open note and opens another', async () => {
    const onSelect = vi.fn();
    render(<NoteList notes={notes} active="content/notes/streaming/index.mdx" onSelect={onSelect} />);
    expect(screen.getByRole('button', { current: 'page' }).textContent).toContain('Streaming');
    await userEvent.type(screen.getByLabelText('Filter notes'), 'fsync');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /WAL and fsync/ }));
    expect(onSelect).toHaveBeenCalledWith('content/notes/database/wal.mdx');
    await userEvent.type(screen.getByLabelText('Filter notes'), 'zzz');
    expect(screen.getByText(/No note matches/)).toBeTruthy();
  });
});

describe('NoteGate', () => {
  it('opens a readable note and explains one that cannot be read', async () => {
    const files = fakeFiles({ 'content/notes/a.mdx': '# A\n' });
    const { rerender } = render(
      <NoteGate files={files} path="content/notes/a.mdx">
        <p>editor</p>
      </NoteGate>,
    );
    expect(screen.getByText('Opening…')).toBeTruthy();
    expect(await screen.findByText('editor')).toBeTruthy();
    rerender(
      <NoteGate files={files} path="content/notes/missing.mdx">
        <p>editor</p>
      </NoteGate>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be opened: gone/);
    expect(screen.queryByText('editor')).toBeNull();
  });
});
