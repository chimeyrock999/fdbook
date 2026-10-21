// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { decorationsPlugin, useEditorPlugin } from '../../../src/editor/decorations';
import { editorConfig } from '../../../src/plugins';
import { mountEditor } from '../../support/live-editor';

afterEach(cleanup);

const NOTE = 'A <Keyword id="grain" displayName="Grain">grain</Keyword> and :keyword[fact]{id="fact" displayName="Fact"}.\n';

const keywords = (container: HTMLElement) => [...container.querySelectorAll('.studio-keyword')].map((node) => node.textContent);

describe('useEditorPlugin', () => {
  it('decorates the live editor, follows a replaced one and lets go on unmount', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const plugin = decorationsPlugin(editorConfig.decorators);
    const first = mountEditor(container, NOTE);
    const { unmount } = renderHook(() => { useEditorPlugin({ current: container }, plugin); });

    expect(keywords(container)).toEqual(['grain', 'fact']);
    expect(container.querySelectorAll('.studio-hidden')).toHaveLength(3);

    // A Source/Visual switch: the old editor goes, a new one mounts later.
    first.destroy();
    container.replaceChildren();
    const second = mountEditor(container, NOTE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keywords(container)).toEqual(['grain', 'fact']);

    unmount();
    expect(keywords(container)).toEqual([]);
    expect(second.state.plugins).not.toContain(plugin);
    second.destroy();
  });
});
