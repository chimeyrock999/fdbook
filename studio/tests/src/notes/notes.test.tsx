// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteGate } from '../../../src/notes/NoteGate';
import type { createFilesClient } from '../../../src/api/files';
import { movedPage, noteFromUrl, noteRoute, pageFromUrl, pageQuery, previewRoute, syncPath, unsavedNote } from '../../../src/notes/notes';

afterEach(cleanup);

describe('note helpers', () => {
  it('counts a note as unsaved only once it reported a status other than synced', () => {
    const note = 'content/docs/guide/a.mdx';
    // The editor starts at 'synced' and reports changes only.
    expect(unsavedNote(note, null)).toBeNull();
    expect(unsavedNote(note, { path: 'content/docs/guide/b.mdx', status: 'dirty' })).toBeNull();
    expect(unsavedNote(note, { path: note, status: 'dirty' })).toBe('guide/a.mdx');
    expect(unsavedNote(note, { path: note, status: 'offline' })).toBe('guide/a.mdx');
    expect(unsavedNote(note, { path: note, status: 'synced' })).toBeNull();
    expect(unsavedNote(null, { path: note, status: 'dirty' })).toBeNull();
  });

  it('maps paths and reads ?path=', () => {
    expect(syncPath('content/docs/streaming/index.mdx')).toBe('streaming/index.mdx');
    expect(noteFromUrl('?path=content%2Fnotes%2Fa.mdx')).toBe('content/docs/a.mdx');
    expect(noteFromUrl('?path=content/docs/meta.yaml')).toBeNull();
    expect(noteFromUrl('?path=package.json')).toBeNull();
    expect(noteFromUrl('')).toBeNull();
  });

  it('reads the page to open: ?path= for a note, ?asset= for a file under public/docs', () => {
    expect(pageFromUrl('?path=content%2Fnotes%2Fa.mdx')).toEqual({ kind: 'note', path: 'content/docs/a.mdx' });
    expect(pageFromUrl('?asset=public%2Fnotes%2Fguide%2Fflow.png')).toEqual({ kind: 'asset', path: 'public/docs/guide/flow.png' });
    expect(pageFromUrl('?asset=public/docs/guide/Photo.PNG')).toEqual({ kind: 'asset', path: 'public/docs/guide/Photo.PNG' });
    expect(pageFromUrl('?asset=public/docs/guide/run.sh')).toBeNull();
    expect(pageFromUrl('?asset=public/docs/../secret.png')).toBeNull();
    expect(pageFromUrl('?asset=public/docs//a.png')).toBeNull();
    expect(pageFromUrl('?asset=public/docs/.cache/a.png')).toBeNull();
    expect(pageFromUrl('?asset=public/docs/a.constructor')).toBeNull();
    expect(pageFromUrl('?asset=content/docs/a.png')).toBeNull();
    expect(pageFromUrl('?path=package.json')).toBeNull();
    expect(pageFromUrl('')).toBeNull();
    for (const page of [{ kind: 'note', path: 'content/docs/a b/c#d.mdx' }, { kind: 'asset', path: 'public/docs/a b/c&d.png' }] as const) {
      expect(pageFromUrl(pageQuery(page))).toEqual(page);
    }
  });

  it('reads a diagram to open: ?diagram= for a file under diagrams/', () => {
    const page = { kind: 'diagram', path: 'diagrams/guide/a b.diagram.json' } as const;
    expect(pageQuery(page)).toBe('?diagram=diagrams%2Fguide%2Fa%20b.diagram.json');
    expect(pageFromUrl(pageQuery(page))).toEqual(page);
    expect(pageFromUrl('?diagram=diagrams/diagram.schema.json')).toBeNull();
    expect(pageFromUrl('?diagram=diagrams/../package.diagram.json')).toBeNull();
    expect(pageFromUrl('?diagram=public/docs/a.png')).toBeNull();
    // A diagram is drawn in notes, not served: Open preview goes home.
    expect(previewRoute(page, () => true)).toBe('/docs');
    expect(previewRoute({ kind: 'diff', path: page.path }, () => true)).toBe('/docs');
  });

  it('reads a diff to open: ?diff= for any file the Studio touches, &from= for its old name', () => {
    expect(pageFromUrl('?diff=content%2Fnotes%2Fa%2Fmeta.yaml')).toEqual({ kind: 'diff', path: 'content/docs/a/meta.yaml' });
    expect(pageFromUrl('?diff=public/docs/a.png')).toEqual({ kind: 'diff', path: 'public/docs/a.png' });
    expect(pageFromUrl('?diff=content/docs/b.mdx&from=content/docs/a.mdx')).toEqual({ kind: 'diff', path: 'content/docs/b.mdx', from: 'content/docs/a.mdx' });
    // An old name the Studio would not touch is left out, not followed.
    expect(pageFromUrl('?diff=content/docs/b.mdx&from=package.json')).toEqual({ kind: 'diff', path: 'content/docs/b.mdx' });
    expect(pageFromUrl('?diff=package.json')).toBeNull();
    expect(pageFromUrl('?diff=content/docs/../package.json')).toBeNull();
    for (const page of [{ kind: 'diff', path: 'content/docs/a b/c#d.mdx' }, { kind: 'diff', path: 'content/docs/n&w.mdx', from: 'content/docs/old.mdx' }] as const) {
      expect(pageFromUrl(pageQuery(page))).toEqual(page);
    }
    // In a change request, the diff is of that worktree's file.
    expect(pageQuery({ kind: 'diff', path: 'content/docs/a.mdx', from: 'content/docs/b.mdx' }, 'sinks')).toBe('?cr=sinks&diff=content%2Fnotes%2Fa.mdx&from=content%2Fnotes%2Fb.mdx');
  });

  it('reads a page history to open: ?history= for a note or an asset', () => {
    expect(pageFromUrl('?history=content%2Fnotes%2Fa%2Fb.mdx')).toEqual({ kind: 'history', path: 'content/docs/a/b.mdx' });
    expect(pageFromUrl('?history=content/docs/a/meta.yaml')).toBeNull();
    expect(pageFromUrl('?history=public/docs/a.png')).toEqual({ kind: 'history', path: 'public/docs/a.png' });
    expect(pageFromUrl('?history=public/docs/a.exe')).toBeNull();
    expect(pageFromUrl('?history=content/docs/../package.mdx')).toBeNull();
    const page = { kind: 'history', path: 'content/docs/a b/c#d.mdx' } as const;
    expect(pageFromUrl(pageQuery(page))).toEqual(page);
    expect(pageQuery(page, 'sinks')).toBe('?cr=sinks&history=content%2Fnotes%2Fa%20b%2Fc%23d.mdx');
    expect(previewRoute(page, () => true)).toBe('/docs/a%20b/c%23d');
  });

  it('opens the deleted pages from ?view=deleted', () => {
    expect(pageFromUrl('?view=deleted')).toEqual({ kind: 'deleted' });
    expect(pageQuery({ kind: 'deleted' }, 'sinks')).toBe('?cr=sinks&view=deleted');
  });

  it('follows a rename to the open note or the note whose history is shown', () => {
    expect(movedPage({ kind: 'note', path: 'content/docs/a/b.mdx' }, 'a/b.mdx', 'a/c.mdx')).toEqual({ kind: 'note', path: 'content/docs/a/c.mdx' });
    expect(movedPage({ kind: 'history', path: 'content/docs/a/b.mdx' }, 'a', 'z')).toEqual({ kind: 'history', path: 'content/docs/z/b.mdx' });
    expect(movedPage({ kind: 'history', path: 'content/docs/a/b.mdx' }, 'a/x.mdx', 'a/y.mdx')).toBeNull();
    expect(movedPage({ kind: 'diff', path: 'content/docs/a/b.mdx' }, 'a/b.mdx', 'a/c.mdx')).toBeNull();
    expect(movedPage(null, 'a/b.mdx', 'a/c.mdx')).toBeNull();
  });

  it('opens the preview at the page shown, and at the notes home where the page has none', () => {
    const there = (path: string) => !path.includes('gone');
    expect(previewRoute(null, there)).toBe('/docs');
    expect(previewRoute({ kind: 'crs' }, there)).toBe('/docs');
    expect(previewRoute({ kind: 'deleted' }, there)).toBe('/docs');
    expect(previewRoute({ kind: 'note', path: 'content/docs/database/index.mdx' }, there)).toBe('/docs/database');
    expect(previewRoute({ kind: 'asset', path: 'public/docs/a b/c.png' }, there)).toBe('/docs/a%20b/c.png');
    expect(previewRoute({ kind: 'diff', path: 'content/docs/streaming/sinks.mdx' }, there)).toBe('/docs/streaming/sinks');
    // A rename opens the page at its new path, not the old one.
    expect(previewRoute({ kind: 'diff', path: 'content/docs/new.mdx', from: 'content/docs/old.mdx' }, there)).toBe('/docs/new');
    expect(previewRoute({ kind: 'diff', path: 'public/docs/a/flow.svg' }, there)).toBe('/docs/a/flow.svg');
    // A meta.yaml has no page, and a deleted file is no longer served.
    expect(previewRoute({ kind: 'diff', path: 'content/docs/streaming/meta.yaml' }, there)).toBe('/docs');
    expect(previewRoute({ kind: 'diff', path: 'content/docs/gone.mdx' }, there)).toBe('/docs');
    expect(previewRoute({ kind: 'diff', path: 'public/docs/gone.png' }, there)).toBe('/docs');
  });

  it('maps a note to its page on the site', () => {
    expect(noteRoute('content/docs/index.mdx')).toBe('/docs');
    expect(noteRoute('content/docs/database/index.mdx')).toBe('/docs/database');
    expect(noteRoute('content/docs/database/wal.mdx')).toBe('/docs/database/wal');
    expect(noteRoute('content/docs/(drafts)/spark/joins.mdx')).toBe('/docs/spark/joins');
    expect(noteRoute('content/docs/a b/c#d.mdx')).toBe('/docs/a%20b/c%23d');
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
    const files = fakeFiles({ 'content/docs/a.mdx': '# A\n' });
    const { rerender } = render(
      <NoteGate files={files} path="content/docs/a.mdx">
        <p>editor</p>
      </NoteGate>,
    );
    expect(screen.getByText('Opening…')).toBeTruthy();
    expect(await screen.findByText('editor')).toBeTruthy();
    rerender(
      <NoteGate files={files} path="content/docs/missing.mdx">
        <p>editor</p>
      </NoteGate>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be opened: gone/);
    expect(screen.queryByText('editor')).toBeNull();
  });
});
