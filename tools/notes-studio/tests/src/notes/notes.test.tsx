// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteGate } from '../../../src/notes/NoteGate';
import type { createFilesClient } from '../../../src/api/files';
import { movedPage, noteFromUrl, noteRoute, pageFromUrl, pageQuery, previewRoute, syncPath, unsavedNote } from '../../../src/notes/notes';

afterEach(cleanup);

describe('note helpers', () => {
  it('counts a note as unsaved only once it reported a status other than synced', () => {
    const note = 'content/notes/guide/a.mdx';
    // The editor starts at 'synced' and reports changes only.
    expect(unsavedNote(note, null)).toBeNull();
    expect(unsavedNote(note, { path: 'content/notes/guide/b.mdx', status: 'dirty' })).toBeNull();
    expect(unsavedNote(note, { path: note, status: 'dirty' })).toBe('guide/a.mdx');
    expect(unsavedNote(note, { path: note, status: 'offline' })).toBe('guide/a.mdx');
    expect(unsavedNote(note, { path: note, status: 'synced' })).toBeNull();
    expect(unsavedNote(null, { path: note, status: 'dirty' })).toBeNull();
  });

  it('maps paths and reads ?path=', () => {
    expect(syncPath('content/notes/streaming/index.mdx')).toBe('streaming/index.mdx');
    expect(noteFromUrl('?path=content%2Fnotes%2Fa.mdx')).toBe('content/notes/a.mdx');
    expect(noteFromUrl('?path=content/notes/meta.yaml')).toBeNull();
    expect(noteFromUrl('?path=package.json')).toBeNull();
    expect(noteFromUrl('')).toBeNull();
  });

  it('reads the page to open: ?path= for a note, ?asset= for a file under public/notes', () => {
    expect(pageFromUrl('?path=content%2Fnotes%2Fa.mdx')).toEqual({ kind: 'note', path: 'content/notes/a.mdx' });
    expect(pageFromUrl('?asset=public%2Fnotes%2Fguide%2Fflow.png')).toEqual({ kind: 'asset', path: 'public/notes/guide/flow.png' });
    expect(pageFromUrl('?asset=public/notes/guide/Photo.PNG')).toEqual({ kind: 'asset', path: 'public/notes/guide/Photo.PNG' });
    expect(pageFromUrl('?asset=public/notes/guide/run.sh')).toBeNull();
    expect(pageFromUrl('?asset=public/notes/../secret.png')).toBeNull();
    expect(pageFromUrl('?asset=public/notes//a.png')).toBeNull();
    expect(pageFromUrl('?asset=public/notes/.cache/a.png')).toBeNull();
    expect(pageFromUrl('?asset=public/notes/a.constructor')).toBeNull();
    expect(pageFromUrl('?asset=content/notes/a.png')).toBeNull();
    expect(pageFromUrl('?path=package.json')).toBeNull();
    expect(pageFromUrl('')).toBeNull();
    for (const page of [{ kind: 'note', path: 'content/notes/a b/c#d.mdx' }, { kind: 'asset', path: 'public/notes/a b/c&d.png' }] as const) {
      expect(pageFromUrl(pageQuery(page))).toEqual(page);
    }
  });

  it('reads a diagram to open: ?diagram= for a file under diagrams/', () => {
    const page = { kind: 'diagram', path: 'diagrams/guide/a b.diagram.json' } as const;
    expect(pageQuery(page)).toBe('?diagram=diagrams%2Fguide%2Fa%20b.diagram.json');
    expect(pageFromUrl(pageQuery(page))).toEqual(page);
    expect(pageFromUrl('?diagram=diagrams/diagram.schema.json')).toBeNull();
    expect(pageFromUrl('?diagram=diagrams/../package.diagram.json')).toBeNull();
    expect(pageFromUrl('?diagram=public/notes/a.png')).toBeNull();
    // A diagram is drawn in notes, not served: Open preview goes home.
    expect(previewRoute(page, () => true)).toBe('/notes');
    expect(previewRoute({ kind: 'diff', path: page.path }, () => true)).toBe('/notes');
  });

  it('reads a diff to open: ?diff= for any file the Studio touches, &from= for its old name', () => {
    expect(pageFromUrl('?diff=content%2Fnotes%2Fa%2Fmeta.yaml')).toEqual({ kind: 'diff', path: 'content/notes/a/meta.yaml' });
    expect(pageFromUrl('?diff=public/notes/a.png')).toEqual({ kind: 'diff', path: 'public/notes/a.png' });
    expect(pageFromUrl('?diff=content/notes/b.mdx&from=content/notes/a.mdx')).toEqual({ kind: 'diff', path: 'content/notes/b.mdx', from: 'content/notes/a.mdx' });
    // An old name the Studio would not touch is left out, not followed.
    expect(pageFromUrl('?diff=content/notes/b.mdx&from=package.json')).toEqual({ kind: 'diff', path: 'content/notes/b.mdx' });
    expect(pageFromUrl('?diff=package.json')).toBeNull();
    expect(pageFromUrl('?diff=content/notes/../package.json')).toBeNull();
    for (const page of [{ kind: 'diff', path: 'content/notes/a b/c#d.mdx' }, { kind: 'diff', path: 'content/notes/n&w.mdx', from: 'content/notes/old.mdx' }] as const) {
      expect(pageFromUrl(pageQuery(page))).toEqual(page);
    }
    // In a change request, the diff is of that worktree's file.
    expect(pageQuery({ kind: 'diff', path: 'content/notes/a.mdx', from: 'content/notes/b.mdx' }, 'sinks')).toBe('?cr=sinks&diff=content%2Fnotes%2Fa.mdx&from=content%2Fnotes%2Fb.mdx');
  });

  it('reads a page history to open: ?history= for a note or an asset', () => {
    expect(pageFromUrl('?history=content%2Fnotes%2Fa%2Fb.mdx')).toEqual({ kind: 'history', path: 'content/notes/a/b.mdx' });
    expect(pageFromUrl('?history=content/notes/a/meta.yaml')).toBeNull();
    expect(pageFromUrl('?history=public/notes/a.png')).toEqual({ kind: 'history', path: 'public/notes/a.png' });
    expect(pageFromUrl('?history=public/notes/a.exe')).toBeNull();
    expect(pageFromUrl('?history=content/notes/../package.mdx')).toBeNull();
    const page = { kind: 'history', path: 'content/notes/a b/c#d.mdx' } as const;
    expect(pageFromUrl(pageQuery(page))).toEqual(page);
    expect(pageQuery(page, 'sinks')).toBe('?cr=sinks&history=content%2Fnotes%2Fa%20b%2Fc%23d.mdx');
    expect(previewRoute(page, () => true)).toBe('/notes/a%20b/c%23d');
  });

  it('opens the deleted pages from ?view=deleted', () => {
    expect(pageFromUrl('?view=deleted')).toEqual({ kind: 'deleted' });
    expect(pageQuery({ kind: 'deleted' }, 'sinks')).toBe('?cr=sinks&view=deleted');
  });

  it('follows a rename to the open note or the note whose history is shown', () => {
    expect(movedPage({ kind: 'note', path: 'content/notes/a/b.mdx' }, 'a/b.mdx', 'a/c.mdx')).toEqual({ kind: 'note', path: 'content/notes/a/c.mdx' });
    expect(movedPage({ kind: 'history', path: 'content/notes/a/b.mdx' }, 'a', 'z')).toEqual({ kind: 'history', path: 'content/notes/z/b.mdx' });
    expect(movedPage({ kind: 'history', path: 'content/notes/a/b.mdx' }, 'a/x.mdx', 'a/y.mdx')).toBeNull();
    expect(movedPage({ kind: 'diff', path: 'content/notes/a/b.mdx' }, 'a/b.mdx', 'a/c.mdx')).toBeNull();
    expect(movedPage(null, 'a/b.mdx', 'a/c.mdx')).toBeNull();
  });

  it('opens the preview at the page shown, and at the notes home where the page has none', () => {
    const there = (path: string) => !path.includes('gone');
    expect(previewRoute(null, there)).toBe('/notes');
    expect(previewRoute({ kind: 'crs' }, there)).toBe('/notes');
    expect(previewRoute({ kind: 'deleted' }, there)).toBe('/notes');
    expect(previewRoute({ kind: 'note', path: 'content/notes/database/index.mdx' }, there)).toBe('/notes/database');
    expect(previewRoute({ kind: 'asset', path: 'public/notes/a b/c.png' }, there)).toBe('/notes/a%20b/c.png');
    expect(previewRoute({ kind: 'diff', path: 'content/notes/streaming/sinks.mdx' }, there)).toBe('/notes/streaming/sinks');
    // A rename opens the page at its new path, not the old one.
    expect(previewRoute({ kind: 'diff', path: 'content/notes/new.mdx', from: 'content/notes/old.mdx' }, there)).toBe('/notes/new');
    expect(previewRoute({ kind: 'diff', path: 'public/notes/a/flow.svg' }, there)).toBe('/notes/a/flow.svg');
    // A meta.yaml has no page, and a deleted file is no longer served.
    expect(previewRoute({ kind: 'diff', path: 'content/notes/streaming/meta.yaml' }, there)).toBe('/notes');
    expect(previewRoute({ kind: 'diff', path: 'content/notes/gone.mdx' }, there)).toBe('/notes');
    expect(previewRoute({ kind: 'diff', path: 'public/notes/gone.png' }, there)).toBe('/notes');
  });

  it('maps a note to its page on the site', () => {
    expect(noteRoute('content/notes/index.mdx')).toBe('/notes');
    expect(noteRoute('content/notes/database/index.mdx')).toBe('/notes/database');
    expect(noteRoute('content/notes/database/wal.mdx')).toBe('/notes/database/wal');
    expect(noteRoute('content/notes/(drafts)/spark/joins.mdx')).toBe('/notes/spark/joins');
    expect(noteRoute('content/notes/a b/c#d.mdx')).toBe('/notes/a%20b/c%23d');
  });

});

// A files client over an in-memory map of worktree paths to contents.
function fakeFiles(contents: Record<string, string>) {
  return {
    readFile: (path: string) => {
      return path in contents
        ? Promise.resolve({ path, content: contents[path], mtimeMs: 1 })
        : Promise.reject(new Error('gone'));
    },
  } as unknown as ReturnType<typeof createFilesClient>;
}

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
