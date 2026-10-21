// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { cleanup, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { decorationsPlugin, useEditorPlugin } from '../../../src/editor/decorations';
import { editorConfig } from '../../../src/plugins';
import { defined } from '../../support/editor-state';
import { mountEditor } from '../../support/live-editor';

// Text first: a selected block shows its source instead of the cards.
const NOTE = [
  'Intro.',
  '',
  '::::accordions',
  ':::accordion{kind="question" title="First"}',
  'One.',
  ':::',
  '',
  ':::accordion{kind="tip" title="Second"}',
  'Two.',
  ':::',
  '::::',
  '',
].join('\n');

let editor: Editor | null = null;

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  editor = mountEditor(container, NOTE);
  renderHook(() => { useEditorPlugin({ current: container }, decorationsPlugin(editorConfig.decorators)); });
  return { container, editor };
}

const value = (live: Editor) => {
  let found = '';
  live.state.doc.descendants((node) => {
    if (node.type.name === 'verbatim') found = String(node.attrs.value);
  });
  return found;
};
const textareas = (container: HTMLElement) => [...container.querySelectorAll('textarea')];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// What MdxEditor's store saves (attachEditor in @fumadocs-editor/ui): the
// document 250ms after an update, or at once on the editor's blur. Closing
// the note drops a pending save.
function store(live: Editor) {
  let saved = value(live);
  let timer: ReturnType<typeof setTimeout> | undefined;
  live.on('update', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { saved = value(live); }, 250);
  });
  live.on('blur', () => {
    clearTimeout(timer);
    saved = value(live);
  });
  return {
    saved: () => saved,
    close: () => { clearTimeout(timer); },
  };
}

describe('accordion cards', () => {
  it('writes a body when the focus leaves and hands the focus on after the rebuild', async () => {
    const { container, editor: live } = mount();
    for (const head of container.querySelectorAll('button.studio-accordion-head')) await userEvent.click(head);
    const [first, second] = textareas(container);
    await userEvent.clear(defined(first));
    await userEvent.type(defined(first), 'Changed.');
    expect(value(live)).toContain('One.');
    await userEvent.click(defined(second));
    expect(value(live)).toContain(':::accordion{kind="question" title="First"}\nChanged.\n:::');
    // The cards were rebuilt, both items are still open and the focus is in
    // the new second body.
    const rebuilt = textareas(container);
    expect(rebuilt[1]).not.toBe(second);
    expect(document.activeElement).toBe(rebuilt[1]);
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2);
  });

  it('writes a body as typing pauses and keeps the caret in it', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(defined(container.querySelector<HTMLElement>('button.studio-accordion-head')));
    const first = defined(container.querySelector('textarea'));
    await userEvent.click(first);
    first.setSelectionRange(3, 3);
    await userEvent.keyboard('XY');
    expect(value(live)).toContain('\nOne.\n');
    await wait(300);
    expect(value(live)).toContain('\nOneXY.\n');
    const rebuilt = defined(container.querySelector('textarea'));
    expect(rebuilt).not.toBe(first);
    expect(document.activeElement).toBe(rebuilt);
    expect([rebuilt.selectionStart, rebuilt.selectionEnd]).toEqual([5, 5]);
    await userEvent.keyboard('Z');
    await wait(300);
    expect(value(live)).toContain('\nOneXYZ.\n');
  });

  // Typing in a body, then picking another note: the write happens on the
  // way out and must be saved before the note closes.
  it('saves a body written just before the note closes', async () => {
    const { container, editor: live } = mount();
    const saving = store(live);
    await userEvent.click(defined(container.querySelector<HTMLElement>('button.studio-accordion-head')));
    const first = defined(container.querySelector('textarea'));
    await userEvent.click(first);
    await userEvent.keyboard('{End} Plus.');
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    saving.close();
    expect(saving.saved()).toContain('\nOne. Plus.\n');
  });

  it('writes nothing into a locked note', async () => {
    const { container, editor: live } = mount();
    const before = value(live);
    live.setEditable(false);
    await userEvent.click(defined(container.querySelector<HTMLElement>('button.studio-accordion-head')));
    const first = defined(container.querySelector('textarea'));
    await userEvent.click(first);
    expect(first.readOnly).toBe(true);
    first.value = 'Changed.';
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(value(live)).toBe(before);
  });
});
