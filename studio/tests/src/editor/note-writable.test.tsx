// @vitest-environment jsdom
import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { cleanup, render } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type SyncProps = {
  onOpen: (opened: { text: string; writable: boolean }) => void;
  onStatus: (status: DocumentStatus) => void;
  onWritable: (writable: boolean) => void;
};
const editor = vi.hoisted(() => ({ sync: null as SyncProps | null, editable: undefined as boolean | undefined }));

// The editor itself is not under test: Root keeps what it gets.
vi.mock('@fumadocs-editor/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    MdxEditor: {
      ...(actual.MdxEditor as object),
      Root: ({ sync, editable }: { sync: SyncProps; editable?: boolean; children?: ReactNode }) => {
        editor.sync = sync;
        editor.editable = editable;
        return null;
      },
    },
  };
});

const { NoteEditor } = await import('../../../src/editor/NoteEditor');

afterEach(cleanup);

const sync = () => {
  if (editor.sync === null) throw new Error('no sync');
  return editor.sync;
};

// A writer turned reader while the note is open: the server closes the
// sync connection, and the note comes back not writable on reconnect.
describe('a note whose writable changes', () => {
  it('locks once the server takes no more edits, and unlocks when it does again', () => {
    const props = { path: 'a/index.mdx', assets: [], files: {}, lint: {} } as unknown as Parameters<typeof NoteEditor>[0];
    render(<NoteEditor {...props} />);
    act(() => {
      sync().onStatus('synced');
      sync().onOpen({ text: 'A note.\n', writable: true });
      sync().onWritable(true);
    });
    expect(editor.editable).toBe(true);
    act(() => { sync().onWritable(false); });
    expect(editor.editable).toBe(false);
    act(() => { sync().onWritable(true); });
    expect(editor.editable).toBe(true);
  });
});
