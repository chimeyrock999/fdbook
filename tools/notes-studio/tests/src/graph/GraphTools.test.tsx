// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decorationsPlugin, useEditorPlugin } from '../../../src/editor/decorations';
import { graphCommand } from '../../../src/graph/graph-plugin';
import { GraphTools } from '../../../src/graph/GraphTools';
import { editorConfig } from '../../../src/plugins';
import { defined } from '../../support/editor-state';
import { mountVisual, stubLayout, textAt } from '../../support/visual-editor';

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

const decorations = decorationsPlugin(editorConfig.decorators);

// GraphTools beside the editor, with the decorations NoteEditor adds.
function Tools({ container, graph }: { container: RefObject<HTMLElement | null>; graph?: unknown }) {
  useEditorPlugin(container, decorations);
  return <GraphTools container={container} graph={graph} />;
}

async function mount(source: string, editable = true, graph?: unknown) {
  const view = await mountVisual(source, { editable, extra: (container) => <Tools container={container} graph={graph} /> });
  // The toolbar registers after the live editor is up.
  await vi.waitFor(() => { expect(view.editor.state.plugins.some((plugin) => (plugin.spec.key as { key?: string } | undefined)?.key?.startsWith('studioGraph'))).toBe(true); });
  const select = (needle: string, nth = 0) => {
    const from = textAt(view.editor, needle, nth);
    act(() => { view.editor.chain().focus().setTextSelection({ from, to: from + needle.length }).run(); });
  };
  const caret = (needle: string, offset = 0) => {
    const at = textAt(view.editor, needle) + offset;
    act(() => { view.editor.chain().focus().setTextSelection(at).run(); });
  };
  // The bar draws after the editor's update.
  const press = async (name: RegExp) => {
    const button = await screen.findByRole('button', { name });
    act(() => { fireEvent.mouseDown(button); });
  };
  const input = (label: string) => screen.getByRole('textbox', { name: label });
  return { ...view, select, caret, press, input };
}

describe('GraphTools', () => {
  it("docks to the editor's own format bubble, found the way the Studio finds it", async () => {
    const view = await mount('Mỗi process có một Process Control Block lưu trạng thái.\n');
    view.select('Process Control Block');
    // The real BubbleMenu of @fumadocs-editor/ui shows for the selection, and
    // the bar finds it: if a tiptap or editor update changes how the bubble
    // is shown, the bar falls back to the selection and this fails.
    await vi.waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Graph' }).dataset.docked).toBe('bubble');
    }, { timeout: 2000 });
    expect(screen.getByRole('toolbar', { name: 'Graph' }).style.visibility).toBe('visible');
  });

  it('follows the bubble when it slides to a new place, and shows once it is there', async () => {
    const view = await mount('Mỗi process có một Process Control Block lưu trạng thái.\n');
    view.select('Process Control Block');
    // Hidden from the accessibility tree while it waits for the bubble.
    const bar = await screen.findByRole('toolbar', { name: 'Graph', hidden: true });
    await vi.waitFor(() => { expect(bar.dataset.docked).toBe('bubble'); }, { timeout: 2000 });
    // The bubble BubbleMenu shows, as the bar found it.
    const bubble = defined(
      [...document.querySelectorAll<HTMLElement>('[style]')].find((element) => element.style.visibility === 'visible' && element.style.position === 'absolute' && !element.contains(view.prose)),
      'bubble',
    );
    // It moves: its new inline place is set, then it slides there (a
    // transition on top/left), still far from the selection when the style
    // changes. Hidden meanwhile; docked again once the slide ends near it.
    // jsdom puts the selection at 0.
    bubble.getBoundingClientRect = () => new DOMRect(0, 500, 300, 38);
    bubble.style.left = '12px';
    await vi.waitFor(() => { expect(bar.dataset.docked).toBe('selection'); });
    act(() => { bubble.dispatchEvent(new Event('transitionrun')); });
    expect(bar.style.visibility).toBe('hidden');
    bubble.getBoundingClientRect = () => new DOMRect(0, 20, 300, 38);
    act(() => { bubble.dispatchEvent(new Event('transitionend')); });
    await vi.waitFor(() => { expect(bar.dataset.docked).toBe('bubble'); });
    expect(bar.style.visibility).toBe('visible');
  });

  it('shows at once for a caret, which the bubble never shows for', async () => {
    const view = await mount('## Process Control Block\n\nText.\n');
    view.caret('Process', 2);
    const bar = await screen.findByRole('toolbar', { name: 'Graph' });
    expect(bar.style.visibility).toBe('visible');
    view.caret('Control', 1);
    expect(screen.getByRole('toolbar', { name: 'Graph' }).style.visibility).toBe('visible');
  });

  it('wraps a selection as a Keyword and writes the edited fields', async () => {
    const view = await mount('Mỗi process có một Process Control Block lưu trạng thái.\n');
    view.select('Process Control Block');
    const bar = await screen.findByRole('toolbar', { name: 'Graph' });
    expect(screen.getByRole('button', { name: /Graph node/ })).toHaveProperty('disabled', true);
    expect(bar.textContent).toContain('Keyword');
    await view.press(/^Keyword/);

    // The marker is written with its defaults, then its fields open.
    await view.written('Mỗi process có một <Keyword id="process-control-block" displayName="Process Control Block">Process Control Block</Keyword> lưu trạng thái.\n');
    const dialog = await screen.findByRole('dialog', { name: 'Keyword id' });
    expect(view.input('id')).toHaveProperty('value', 'process-control-block');
    expect(document.activeElement).toBe(view.input('Text'));
    fireEvent.change(view.input('id'), { target: { value: 'pcb' } });
    fireEvent.change(view.input('displayName'), { target: { value: 'PCB' } });
    // An edit from disk above the marker keeps the fields and what was typed.
    act(() => { view.editor.view.dispatch(view.editor.state.tr.insertText('Hôm nay. ', 1)); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(view.input('id')).toHaveProperty('value', 'pcb');
    act(() => { fireEvent.keyDown(view.input('displayName'), { key: 'Enter' }); });
    await view.written('Hôm nay. Mỗi process có một <Keyword id="pcb" displayName="PCB">Process Control Block</Keyword> lưu trạng thái.\n');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs the shortcuts and leaves the defaults on Escape', async () => {
    const view = await mount('A fact table.\n\n### Yet Another Resource Negotiator\n');
    view.select('fact table');
    view.key('t', { ctrlKey: true, altKey: true });
    await view.written('A <Tag id="fact-table" displayName="fact table">fact table</Tag>.\n\n### Yet Another Resource Negotiator\n');
    const dialog = await screen.findByRole('dialog', { name: 'Tag id' });
    fireEvent.change(view.input('id'), { target: { value: 'not-saved' } });
    act(() => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();

    view.caret('Negotiator', 3);
    view.key('g', { ctrlKey: true, altKey: true });
    await view.written('A <Tag id="fact-table" displayName="fact table">fact table</Tag>.\n\n### Yet Another Resource Negotiator :graph-meta{id="yet-another-resource-negotiator" displayName="Yet Another Resource Negotiator"}\n');
    await screen.findByRole('dialog', { name: 'Graph node id' });
  });

  it('marks a heading from the bar and edits its title with the id', async () => {
    const view = await mount('### Hadoop Overview\n\nText.\n');
    view.caret('Overview', 2);
    expect(await screen.findByRole('button', { name: /^Keyword/ })).toHaveProperty('disabled', true);
    await view.press(/Graph node/);
    const dialog = await screen.findByRole('dialog', { name: 'Graph node id' });
    fireEvent.change(view.input('Text'), { target: { value: 'Hadoop at a glance' } });
    fireEvent.change(view.input('displayName'), { target: { value: 'Hadoop' } });
    act(() => { fireEvent.submit(dialog); });
    await view.written('### Hadoop at a glance :graph-meta{id="hadoop-overview" displayName="Hadoop"}\n\nText.\n');
  });

  it('opens the fields of a new marker and fills them from its text', async () => {
    const view = await mount('A <Keyword id="" displayName="">keyword</Keyword> here.\n');
    view.caret('keyword', 2);
    await screen.findByRole('dialog', { name: 'Keyword id' });
    fireEvent.change(view.input('Text'), { target: { value: 'Đồng bộ' } });
    expect(view.input('id')).toHaveProperty('value', 'dong-bo');
    expect(view.input('displayName')).toHaveProperty('value', 'Đồng bộ');
    // A press elsewhere writes them.
    act(() => { fireEvent.mouseDown(document.body); });
    await view.written('A <Keyword id="dong-bo" displayName="Đồng bộ">Đồng bộ</Keyword> here.\n');
  });

  it('opens the fields from a marker and from the bar', async () => {
    const view = await mount('### Block :graph-meta{id="block" displayName="Block"}\n\nA <Keyword id="grain" displayName="Grain">grain</Keyword>.\n');
    const marker = await vi.waitFor(() => defined(view.container.querySelector('.studio-graph-meta'), 'marker'));
    act(() => { fireEvent.mouseDown(marker); });
    await screen.findByRole('dialog', { name: 'Graph node id' });
    expect(view.input('id')).toHaveProperty('value', 'block');
    act(() => { fireEvent.keyDown(view.input('id'), { key: 'Escape' }); });

    view.caret('grain', 2);
    await view.press(/Edit keyword id/);
    await screen.findByRole('dialog', { name: 'Keyword id' });
    expect(view.input('displayName')).toHaveProperty('value', 'Grain');
  });

  // Enter commits a Telex/VNI word and Escape drops it; neither may save or
  // close the fields. Safari sends them with keyCode 229 after the
  // composition ended.
  it('leaves the keys that end an IME composition to the IME', async () => {
    const view = await mount('A term.\n');
    view.select('term');
    await view.press(/^Keyword/);
    const dialog = await screen.findByRole('dialog', { name: 'Keyword id' });
    const field = view.input('displayName');
    // A cancelled Enter keydown is what stops the form's implicit submit.
    expect(fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })).toBe(false);
    act(() => { fireEvent.keyDown(field, { key: 'Escape', keyCode: 229 }); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.change(field, { target: { value: 'Thuật ngữ' } });
    act(() => { fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await view.written('A <Keyword id="term" displayName="Thuật ngữ">term</Keyword>.\n');
  });

  it('stays away from a locked note', async () => {
    const view = await mount('A term.\n\n### Heading :graph-meta{id="heading" displayName="Heading"}\n', false);
    // Clicking a marker shows its source but opens no fields.
    const marker = await vi.waitFor(() => defined(view.container.querySelector('.studio-graph-meta'), 'marker'));
    act(() => { fireEvent.mouseDown(marker); });
    expect(screen.queryByRole('dialog')).toBeNull();
    view.select('term');
    view.key('k', { ctrlKey: true, altKey: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.markdown()).toBe('A term.\n\n### Heading :graph-meta{id="heading" displayName="Heading"}\n');
    // The commands refuse it too, whatever runs them.
    const dispatch = vi.fn();
    expect(graphCommand('Keyword')(view.editor.state, dispatch, view.editor.view)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes the marker at the caret from the bar, and only shows Remove on one', async () => {
    const view = await mount('A <Tag id="fact" displayName="Fact">fact</Tag> and a term.\n');
    view.select('term');
    await screen.findByRole('toolbar', { name: 'Graph' });
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    view.caret('fact', 2);
    await view.press(/^Remove tag/);
    await view.written('A fact and a term.\n');
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('removes a graph node with its shortcut, not while an IME composes', async () => {
    const view = await mount('### Hadoop Overview :graph-meta{id="hadoop" displayName="Hadoop"}\n\nText.\n');
    view.caret('Overview', 2);
    expect(await screen.findByRole('button', { name: /^Remove graph node/ })).toBeTruthy();
    view.key('x', { ctrlKey: true, altKey: true, keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.markdown()).toBe('### Hadoop Overview :graph-meta{id="hadoop" displayName="Hadoop"}\n\nText.\n');
    view.key('x', { ctrlKey: true, altKey: true });
    await view.written('### Hadoop Overview\n\nText.\n');
  });

  it('removes from the fields without writing them', async () => {
    const view = await mount('A <Keyword id="grain" displayName="Grain">grain</Keyword>.\n');
    view.caret('grain', 2);
    await view.press(/Edit keyword id/);
    await screen.findByRole('dialog', { name: 'Keyword id' });
    fireEvent.change(view.input('id'), { target: { value: 'not-saved' } });
    const remove = screen.getByRole('button', { name: 'Remove keyword' });
    // Enter on the button is the button's, not the form's save.
    act(() => { fireEvent.keyDown(remove, { key: 'Enter' }); });
    expect(view.markdown()).toBe('A <Keyword id="grain" displayName="Grain">grain</Keyword>.\n');
    act(() => { fireEvent.click(remove); });
    await view.written('A grain.\n');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the frontmatter entries that list the id, and leaves them', async () => {
    const graph = { keywords: [{ id: 'grain', displayName: 'Grain' }], sections: [{ id: 's', displayName: 'S', keywords: [{ id: 'grain', displayName: 'Grain' }] }] };
    const view = await mount('A <Keyword id="grain" displayName="Grain">grain</Keyword> and <Tag id="other" displayName="Other">other</Tag>.\n', true, graph);
    view.caret('grain', 2);
    const bar = await screen.findByRole('toolbar', { name: 'Graph' });
    await vi.waitFor(() => { expect(bar.textContent).toContain('graph.keywords.0, graph.sections.0.keywords.0'); });
    await view.press(/Edit keyword id/);
    expect((await screen.findByRole('dialog')).textContent).toContain('graph.keywords.0');
    act(() => { fireEvent.keyDown(view.input('id'), { key: 'Escape' }); });
    view.caret('other', 2);
    await vi.waitFor(() => { expect(screen.getByRole('toolbar', { name: 'Graph' }).textContent).not.toContain('graph.'); });
  });
});
