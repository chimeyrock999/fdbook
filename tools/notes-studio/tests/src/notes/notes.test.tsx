// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteGate } from '../../../src/notes/NoteGate';
import { OpenOnSite } from '../../../src/notes/OpenOnSite';
import type { createFilesClient } from '../../../src/api/files';
import { noteFromUrl, noteRoute, siteUrlFrom, syncPath, unsavedNote } from '../../../src/notes/notes';

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

describe('OpenOnSite', () => {
  it("links to the note's page on the site, in a new tab", () => {
    render(<OpenOnSite path="content/notes/database/index.mdx" siteUrl="http://127.0.0.1:3001/" />);
    const link = screen.getByRole('link', { name: 'Open on site' });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:3001/notes/database');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('defaults to the dev server on localhost:3000', () => {
    expect(siteUrlFrom(undefined)).toBe('http://localhost:3000');
    expect(siteUrlFrom('  ')).toBe('http://localhost:3000');
    expect(siteUrlFrom(' http://127.0.0.1:3001 ')).toBe('http://127.0.0.1:3001');
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
