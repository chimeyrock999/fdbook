// @vitest-environment jsdom
import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { cleanup, render } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type SyncProps = { onStatus: (status: DocumentStatus) => void };
const editor = vi.hoisted(() => ({ sync: null as SyncProps | null }));

// The editor itself is not under test: Root keeps the sync options it gets.
vi.mock('@fumadocs-editor/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    MdxEditor: {
      ...(actual.MdxEditor as object),
      Root: ({ sync }: { sync: SyncProps; children?: ReactNode }) => {
        editor.sync = sync;
        return null;
      },
    },
  };
});
vi.mock('#api/session.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmSignedIn: vi.fn(() => Promise.resolve()),
}));

const { confirmSignedIn } = await import('#api/session.ts');
const { NoteEditor } = await import('#editor/NoteEditor.tsx');

afterEach(() => {
  cleanup();
  vi.mocked(confirmSignedIn).mockClear();
});

// The server closes the sync socket of a session that ended, and the
// browser cannot see the 401 its reconnect gets (#115): an editor going
// offline asks who is signed in, which brings the sign-in page back.
describe('a note going offline', () => {
  it('asks whether the page is still signed in', () => {
    const props = { path: 'a/index.mdx', assets: [], files: {}, lint: {} } as unknown as Parameters<typeof NoteEditor>[0];
    const onStatus = vi.fn();
    render(<NoteEditor {...props} onStatus={onStatus} />);
    act(() => { editor.sync?.onStatus('saving'); });
    expect(confirmSignedIn).not.toHaveBeenCalled();
    act(() => { editor.sync?.onStatus('offline'); });
    expect(confirmSignedIn).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith('offline');
  });
});
