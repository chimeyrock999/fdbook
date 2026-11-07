// @vitest-environment jsdom
import { MdxEditor } from '@fumadocs-editor/ui';
import { Decoration } from '@tiptap/pm/view';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decorationsExtension } from '#features/editor/decorations.ts';
import { editorConfig } from '#features/editor/plugins/index.ts';
import type { Decorator } from '#features/editor/plugins/plugin.ts';
import { stubLayout } from '#tests/support/visual-editor.tsx';

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

const NOTE = 'A grain and a fact.\n\nAnother grain.\n';

// No shipped plugin decorates: one of the test's own marks every "grain".
const grains: Decorator = (state) => {
  const found: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    for (const match of (node.text ?? '').matchAll(/grain/g)) {
      found.push(Decoration.inline(pos + match.index, pos + match.index + match[0].length, { class: 'studio-test-mark' }));
    }
  });
  return found;
};

const marked = (container: HTMLElement) => [...container.querySelectorAll('.ProseMirror[contenteditable] .studio-test-mark')].map((node) => node.textContent);

describe('decorationsExtension', () => {
  it('decorates the live editor as one of the root\'s extensions', async () => {
    const { container } = render(
      <MdxEditor.Root defaultValue={NOTE} components={editorConfig.components} syntax={editorConfig.syntax} extensions={[decorationsExtension([grains])]}>
        <MdxEditor.Visual />
      </MdxEditor.Root>,
    );
    await vi.waitFor(() => { expect(marked(container)).toEqual(['grain', 'grain']); }, { timeout: 3000 });
  });
});
