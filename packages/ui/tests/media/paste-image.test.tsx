// @vitest-environment jsdom
import { MdxEditor, type MdxEditorRef } from '@fumadocs-editor/ui';
import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { lintNote } from '@fdbook/server/lint/lint.ts';
import type { createFilesClient } from '#api/files.ts';
import { createAssetMedia } from '#media/asset-media.ts';
import { editorConfig } from '#plugins/index.ts';
import { defined } from '#tests/support/editor-state.ts';

const NOTE = 'content/docs/data-modeling/index.mdx';

// A pasted image end to end in the live editor: its paste handler, the media
// provider, the Markdown the editor writes, and the site lint that checks the
// asset exists. The save itself goes to a recording file client here (jsdom
// cannot host the Studio server); asset-media.test.ts saves through it.
describe('pasting an image into the editor', () => {
  // jsdom has none; the editor sizes menus.
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(cleanup);

  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' });

  // The live editor over a recording file client. `editable` is what
  // NoteEditor passes: false for a locked note.
  async function mount(editable = true) {
    const written = new Map<string, Blob>();
    const files = {
      writeAsset: (path: string, data: Blob) => {
        written.set(path, data);
        return Promise.resolve(1);
      },
    } as unknown as ReturnType<typeof createFilesClient>;
    const askName = vi.fn(() => Promise.resolve<string | null>('warehouse-layers'));
    const media = createAssetMedia({ files, notePath: NOTE, askName, notify: () => undefined });
    const ref = createRef<MdxEditorRef>();
    const { container } = render(
      <MdxEditor.Root
        defaultValue={'# Data modeling\n\nIntro.\n'}
        ref={ref}
        components={editorConfig.components}
        syntax={editorConfig.syntax}
        media={media}
        editable={editable}
      >
        <MdxEditor.Visual />
      </MdxEditor.Root>,
    );
    const prose = await vi.waitFor(() => {
      // The live editor, once it replaced the static first paint (which has
      // no contenteditable at all).
      const found = defined(container.querySelector<HTMLElement>('.ProseMirror[contenteditable]'), 'editor');
      expect(found.textContent).toContain('Intro.');
      return found;
    }, { timeout: 3000 });
    return { container, ref, written, askName, prose };
  }

  function transfer(target: HTMLElement, type: 'paste' | 'drop') {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const data = { files: [png()], items: [], types: ['Files'], getData: () => '' };
    Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
    act(() => { target.dispatchEvent(event); });
  }

  it('saves it in the page folder and writes a site path the lint accepts', async () => {
    const { container, ref, written, prose } = await mount();
    transfer(prose, 'paste');

    const source = await vi.waitFor(() => {
      const markdown = defined(ref.current).getMarkdown();
      expect(markdown).toContain('(/docs/data-modeling/warehouse-layers.png)');
      return markdown;
    }, { timeout: 3000 });
    expect(source).toMatch(/!\[image\]\(\/docs\/data-modeling\/warehouse-layers\.png\)/);
    expect([...written.keys()]).toEqual(['public/docs/data-modeling/warehouse-layers.png']);
    // The image shows through the file API, not as a broken /docs/… URL.
    const img = await vi.waitFor(() => defined(container.querySelector('img[src]'), 'img'));
    expect(img.getAttribute('src')).toBe('/api/file?path=public%2Fdocs%2Fdata-modeling%2Fwarehouse-layers.png');
    const lint = (exists: boolean) =>
      lintNote(source, { path: 'data-modeling/index.mdx', pages: new Set(['data-modeling/index.mdx']), assetExists: (asset) => exists && written.has(`public/${asset}`), diagramProblem: () => 'missing' })
        .filter((issue) => issue.rule === 'asset-missing');
    expect(lint(true)).toEqual([]);
    // The rule does look at this image.
    expect(lint(false)).toHaveLength(1);
  });

  // A note the Studio may not write (NoteEditor passes editable={false})
  // takes no image: ProseMirror runs no paste or drop handler on a view that
  // is not editable.
  it('takes nothing into a locked note', async () => {
    const { ref, written, askName, prose } = await mount(false);
    const before = defined(ref.current).getMarkdown();
    transfer(prose, 'paste');
    transfer(prose, 'drop');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(askName).not.toHaveBeenCalled();
    expect(written.size).toBe(0);
    expect(defined(ref.current).getMarkdown()).toBe(before);
  });
});
