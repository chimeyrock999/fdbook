// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decorationsExtension } from '../../../src/editor/decorations';
import { pluginsExtension } from '../../../src/editor/extensions';
import { createGraphSource, graphCommand } from '../../../src/graph/graph-plugin';
import { graphBubbleItems } from '../../../src/graph/bubble-items';
import { GraphTools } from '../../../src/graph/GraphTools';
import { editorConfig } from '../../../src/plugins';
import { defined } from '../../support/editor-state';
import { mountVisual, stubLayout, textAt } from '../../support/visual-editor';

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

const decorations = decorationsExtension(editorConfig.decorators);

// GraphTools beside the editor, with the decorations NoteEditor adds.
async function mount(source: string, editable = true, graph?: unknown) {
  const tools = createGraphSource();
  const extensions = [decorations, pluginsExtension('studioNote', [tools.plugin])];
  const view = await mountVisual(source, { editable, extensions, bubbleItems: graphBubbleItems, extra: () => <GraphTools source={tools} graph={graph} /> });
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
  // The bubble draws after the editor's update.
  const press = async (name: RegExp) => {
    const button = await screen.findByRole('button', { name });
    act(() => {
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    });
  };
  const input = (label: string) => screen.getByRole('textbox', { name: label });
  // The Graph button at the end of a heading: a widget inside the editor.
  const addButton = (heading: string) => {
    const found = [...view.prose.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((element) => element.textContent.includes(heading));
    return found?.querySelector<HTMLElement>('.studio-graph-add') ?? null;
  };
  // A click on the editor at `pos` (the text after a marker's id is the
  // second match of the word), as ProseMirror reports a plain click
  // (no drag) to its plugins.
  const click = (pos: number, target: Element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'target', { value: target });
    let handled = false;
    act(() => {
      handled = view.editor.view.someProp('handleClick', (handle) => handle(view.editor.view, pos, event)) ?? false;
    });
    return handled;
  };
  return { ...view, select, caret, press, input, addButton, click };
}

describe('GraphTools', () => {
  it('puts Keyword and Tag in the editor format bubble for a text selection, and no bar', async () => {
    const view = await mount('Mỗi process có một Process Control Block lưu trạng thái.\n\n### Hadoop Overview\n');
    view.select('Process Control Block');
    const keyword = await screen.findByRole('button', { name: 'Keyword' });
    expect(keyword).toHaveProperty('disabled', false);
    expect(keyword.dataset.active).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Tag' })).toHaveProperty('disabled', false);
    // No floating graph bar, for a selection or a caret in a heading.
    view.caret('Overview', 2);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByRole('toolbar', { name: 'Graph' })).toBeNull();
  });

  it("toggles a keyword off from the bubble, like Bold, and keeps its text", async () => {
    const view = await mount('A <Keyword id="fact" displayName="Fact">fact term</Keyword> here.\n');
    view.select('term');
    const keyword = await screen.findByRole('button', { name: 'Keyword' });
    await vi.waitFor(() => { expect(keyword.dataset.active).toBe('true'); });
    expect(keyword).toHaveProperty('disabled', false);
    // Tag neither wraps here nor is active.
    expect(screen.getByRole('button', { name: 'Tag' })).toHaveProperty('disabled', true);
    await view.press(/^Keyword$/);
    await view.written('A fact term here.\n');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles a tag off from its own button', async () => {
    const view = await mount('A <Tag id="fact" displayName="Fact">fact table</Tag> here.\n');
    view.select('table');
    const tag = await screen.findByRole('button', { name: 'Tag' });
    await vi.waitFor(() => { expect(tag.dataset.active).toBe('true'); });
    expect(screen.getByRole('button', { name: 'Keyword' })).toHaveProperty('disabled', true);
    await view.press(/^Tag$/);
    await view.written('A fact table here.\n');
  });

  it('wraps a selection as a Keyword and writes the edited fields', async () => {
    const view = await mount('Mỗi process có một Process Control Block lưu trạng thái.\n');
    view.select('Process Control Block');
    await view.press(/^Keyword$/);

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

  it('puts a Graph button at the end of a heading that can take a graph node', async () => {
    const view = await mount('### Hadoop Overview\n\n### Block :graph-meta{id="block" displayName="Block"}\n\n### \n\nText.\n');
    const add = await vi.waitFor(() => defined(view.addButton('Hadoop Overview'), 'Graph button'));
    expect(add.textContent).toBe('Graph');
    expect(add.title).toMatch(/^Add graph node \(/);
    // Not on a heading with a marker, nor in text.
    expect(view.addButton('Block')).toBeNull();
    expect(view.prose.querySelectorAll('.studio-graph-add')).toHaveLength(1);
    // The caret's heading is marked, for the CSS that shows the button
    // without a hover (touch).
    view.caret('Overview', 2);
    await vi.waitFor(() => { expect(add.closest('h3')?.classList.contains('studio-graph-here')).toBe(true); });
    view.caret('Text', 1);
    await vi.waitFor(() => { expect(view.prose.querySelector('.studio-graph-here')).toBeNull(); });
    // Nothing goes into the note.
    expect(view.markdown()).toBe('### Hadoop Overview\n\n### Block :graph-meta{id="block" displayName="Block"}\n\n### \n\nText.\n');
  });

  it('marks a heading from its Graph button and edits its title with the id', async () => {
    const view = await mount('Text.\n\n### Hadoop Overview\n');
    view.caret('Text', 1);
    const add = await vi.waitFor(() => defined(view.addButton('Hadoop Overview'), 'Graph button'));
    act(() => { fireEvent.mouseDown(add); });
    await view.written('Text.\n\n### Hadoop Overview :graph-meta{id="hadoop-overview" displayName="Hadoop Overview"}\n');
    const dialog = await screen.findByRole('dialog', { name: 'Graph node id' });
    expect(view.addButton('Hadoop Overview')).toBeNull();
    fireEvent.change(view.input('Text'), { target: { value: 'Hadoop at a glance' } });
    fireEvent.change(view.input('displayName'), { target: { value: 'Hadoop' } });
    act(() => { fireEvent.submit(dialog); });
    await view.written('Text.\n\n### Hadoop at a glance :graph-meta{id="hadoop-overview" displayName="Hadoop"}\n');
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

  it('opens the fields from a graph node marker and from a click on a JSX keyword', async () => {
    const view = await mount('### Block :graph-meta{id="block" displayName="Block"}\n\nA <Keyword id="grain" displayName="Grain">grain</Keyword> and plain text.\n');
    const marker = await vi.waitFor(() => defined(view.container.querySelector('.studio-graph-meta'), 'marker'));
    act(() => { fireEvent.mouseDown(marker); });
    await screen.findByRole('dialog', { name: 'Graph node id' });
    expect(view.input('id')).toHaveProperty('value', 'block');
    act(() => { fireEvent.keyDown(view.input('id'), { key: 'Escape' }); });

    const keyword = defined(view.prose.querySelector('span.studio-keyword'), 'keyword');
    expect(view.click(textAt(view.editor, 'grain', 1) + 2, keyword)).toBe(true);
    await screen.findByRole('dialog', { name: 'Keyword id' });
    expect(view.input('displayName')).toHaveProperty('value', 'Grain');
    act(() => { fireEvent.keyDown(view.input('id'), { key: 'Escape' }); });

    // A click on plain text is the editor's.
    const paragraph = defined(view.prose.querySelector('p'), 'paragraph');
    expect(view.click(textAt(view.editor, 'plain') + 1, paragraph)).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Enter commits a Telex/VNI word and Escape drops it; neither may save or
  // close the fields. Safari sends them with keyCode 229 after the
  // composition ended.
  it('leaves the keys that end an IME composition to the IME', async () => {
    const view = await mount('A term.\n');
    view.select('term');
    await view.press(/^Keyword$/);
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
    const view = await mount('A <Keyword id="grain" displayName="Grain">grain</Keyword> term.\n\n### Heading :graph-meta{id="heading" displayName="Heading"}\n\n### Plain\n', false);
    // Clicking a marker shows its source but opens no fields.
    const marker = await vi.waitFor(() => defined(view.container.querySelector('.studio-graph-meta'), 'marker'));
    act(() => { fireEvent.mouseDown(marker); });
    expect(screen.queryByRole('dialog')).toBeNull();
    const keyword = defined(view.prose.querySelector('span.studio-keyword'), 'keyword');
    expect(view.click(textAt(view.editor, 'grain', 1) + 2, keyword)).toBe(false);
    // The Graph button does nothing (the CSS hides it in a locked editor).
    const add = view.addButton('Plain');
    if (add) act(() => { fireEvent.mouseDown(add); });
    view.select('term');
    view.key('k', { ctrlKey: true, altKey: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.markdown()).toBe('A <Keyword id="grain" displayName="Grain">grain</Keyword> term.\n\n### Heading :graph-meta{id="heading" displayName="Heading"}\n\n### Plain\n');
    // The commands refuse it too, whatever runs them.
    const dispatch = vi.fn();
    expect(graphCommand('Keyword')(view.editor.state, dispatch, view.editor.view)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes a graph node with its shortcut, not while an IME composes', async () => {
    const view = await mount('### Hadoop Overview :graph-meta{id="hadoop" displayName="Hadoop"}\n\nText.\n');
    view.caret('Overview', 2);
    view.key('x', { ctrlKey: true, altKey: true, keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.markdown()).toBe('### Hadoop Overview :graph-meta{id="hadoop" displayName="Hadoop"}\n\nText.\n');
    view.key('x', { ctrlKey: true, altKey: true });
    await view.written('### Hadoop Overview\n\nText.\n');
  });

  it('removes from the fields without writing them', async () => {
    const view = await mount('A <Tag id="grain" displayName="Grain">grain</Tag>.\n');
    const tag = await vi.waitFor(() => defined(view.prose.querySelector('span.studio-keyword'), 'tag'));
    view.click(textAt(view.editor, 'grain', 1) + 2, tag);
    await screen.findByRole('dialog', { name: 'Tag id' });
    fireEvent.change(view.input('id'), { target: { value: 'not-saved' } });
    const remove = screen.getByRole('button', { name: 'Remove tag' });
    // Enter on the button is the button's, not the form's save.
    act(() => { fireEvent.keyDown(remove, { key: 'Enter' }); });
    expect(view.markdown()).toBe('A <Tag id="grain" displayName="Grain">grain</Tag>.\n');
    act(() => { fireEvent.click(remove); });
    await view.written('A grain.\n');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the frontmatter entries that list the id, and leaves them', async () => {
    const graph = { keywords: [{ id: 'grain', displayName: 'Grain' }], sections: [{ id: 's', displayName: 'S', keywords: [{ id: 'grain', displayName: 'Grain' }] }] };
    const view = await mount('A <Keyword id="grain" displayName="Grain">grain</Keyword> and <Tag id="other" displayName="Other">other</Tag>.\n', true, graph);
    const [grain, other] = await vi.waitFor(() => {
      const found = [...view.prose.querySelectorAll('span.studio-keyword')];
      if (found.length < 2) throw new Error('markers');
      return found;
    });
    view.click(textAt(view.editor, 'grain', 1) + 2, grain);
    expect((await screen.findByRole('dialog')).textContent).toContain('graph.keywords.0, graph.sections.0.keywords.0');
    act(() => { fireEvent.keyDown(view.input('id'), { key: 'Escape' }); });
    view.click(textAt(view.editor, 'other', 1) + 2, other);
    expect((await screen.findByRole('dialog', { name: 'Tag id' })).textContent).not.toContain('graph.');
  });
});
