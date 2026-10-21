// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteGate } from '../../../src/notes/NoteGate';
import type { createFilesClient } from '../../../src/api/files';
import { noteFromUrl, syncPath } from '../../../src/notes/notes';

afterEach(cleanup);

describe('note helpers', () => {
  it('maps paths and reads ?path=', () => {
    expect(syncPath('content/notes/streaming/index.mdx')).toBe('streaming/index.mdx');
    expect(noteFromUrl('?path=content%2Fnotes%2Fa.mdx')).toBe('content/notes/a.mdx');
    expect(noteFromUrl('?path=content/notes/meta.yaml')).toBeNull();
    expect(noteFromUrl('?path=package.json')).toBeNull();
    expect(noteFromUrl('')).toBeNull();
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
