// @vitest-environment jsdom
import { MdxEditor } from '@fumadocs-editor/ui';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decorationsExtension } from '#features/editor/decorations.ts';
import { editorConfig } from '#features/editor/plugins/index.ts';
import { stubLayout } from '#tests/support/visual-editor.tsx';

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

const NOTE = 'A <Keyword id="grain" displayName="Grain">grain</Keyword> and :keyword[fact]{id="fact" displayName="Fact"}.\n';

const keywords = (container: HTMLElement) => [...container.querySelectorAll('.ProseMirror[contenteditable] .studio-keyword')].map((node) => node.textContent);

describe('decorationsExtension', () => {
  it('decorates the live editor as one of the root\'s extensions', async () => {
    const { container } = render(
      <MdxEditor.Root defaultValue={NOTE} components={editorConfig.components} syntax={editorConfig.syntax} extensions={[decorationsExtension(editorConfig.decorators)]}>
        <MdxEditor.Visual />
      </MdxEditor.Root>,
    );
    await vi.waitFor(() => { expect(keywords(container)).toEqual(['grain', 'fact']); }, { timeout: 3000 });
    expect(container.querySelectorAll('.ProseMirror[contenteditable] .studio-hidden')).toHaveLength(3);
  });
});
