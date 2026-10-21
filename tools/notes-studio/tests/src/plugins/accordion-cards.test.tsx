// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { cleanup, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accordionKindVariables } from '@site/lib/notes-accordion';
import { ACCORDION_KINDS } from '@site/lib/notes-syntax';
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

function mount(note = NOTE) {
  const container = document.createElement('div');
  document.body.append(container);
  editor = mountEditor(container, note);
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
const groups = (live: Editor) => {
  const found: string[] = [];
  live.state.doc.descendants((node) => {
    if (node.type.name === 'verbatim') found.push(String(node.attrs.value));
  });
  return found;
};
const textareas = (container: HTMLElement) => [...container.querySelectorAll('textarea')];
const toggles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('button.studio-accordion-state')];
const titles = () => screen.getAllByRole<HTMLInputElement>('textbox', { name: 'Accordion title' });
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
  it('colours each card with the site palette of its kind', () => {
    const { container } = mount();
    const cards = [...container.querySelectorAll<HTMLElement>('.studio-accordion')];
    expect(cards).toHaveLength(2);
    for (const [card, kind] of [[cards[0], 'question'], [cards[1], 'tip']] as const) {
      for (const [name, value] of Object.entries(accordionKindVariables(kind))) expect(card.style.getPropertyValue(name), name).toBe(value);
    }
  });

  it('writes a body when the focus leaves and hands the focus on after the rebuild', async () => {
    const { container, editor: live } = mount();
    for (const toggle of toggles(container)) await userEvent.click(toggle);
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
    expect(toggles(container).map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
  });

  it('writes a body as typing pauses and keeps the caret in it', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(defined(toggles(container)[0]));
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

  // Vietnamese is typed through an IME (Telex, VNI): a write in the middle of
  // a composition would rebuild the textarea under it and duplicate the text.
  it('waits for an IME composition to end before writing', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(defined(toggles(container)[0]));
    const first = defined(container.querySelector('textarea'));
    first.focus();
    first.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    first.value = 'One. tu';
    first.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    await wait(300);
    first.value = 'One. tư';
    first.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await wait(300);
    expect(value(live)).toContain('\nOne.\n');
    expect(first.isConnected).toBe(true);
    first.value = 'One. tươi';
    first.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'tươi' }));
    await wait(300);
    expect(value(live)).toContain('\nOne. tươi\n');
  });

  // Typing in a body, then picking another note: the write happens on the
  // way out and must be saved before the note closes.
  it('saves a body written just before the note closes', async () => {
    const { container, editor: live } = mount();
    const saving = store(live);
    await userEvent.click(defined(toggles(container)[0]));
    const first = defined(container.querySelector('textarea'));
    await userEvent.click(first);
    await userEvent.keyboard('{End} Plus.');
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    saving.close();
    expect(saving.saved()).toContain('\nOne. Plus.\n');
  });

  it('opens an item in its own group only', async () => {
    const { container, editor: live } = mount(`${NOTE}\n${NOTE.replace('Intro.', 'More.').replaceAll('First', 'Third').replaceAll('Second', 'Fourth')}`);
    await userEvent.click(defined(toggles(container)[0]));
    expect(toggles(container).map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false']);
    // A write in the first group keeps its item open.
    const first = defined(textareas(container)[0]);
    await userEvent.click(first);
    await userEvent.keyboard('{End} Plus.');
    await wait(300);
    expect(groups(live)[0]).toContain('One. Plus.');
    expect(toggles(container).map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false']);
    // A write in the second group rebuilds it with its own open items.
    await userEvent.click(defined(toggles(container)[3]));
    const fourth = defined(textareas(container)[3]);
    await userEvent.click(fourth);
    await userEvent.keyboard('{End} Plus.');
    await wait(300);
    expect(groups(live)[1]).toContain('Two. Plus.');
    expect(toggles(container).map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'true']);
  });

  it('writes nothing into a locked note', async () => {
    const { container, editor: live } = mount();
    const before = value(live);
    live.setEditable(false);
    await userEvent.click(defined(toggles(container)[0]));
    const first = defined(container.querySelector('textarea'));
    await userEvent.click(first);
    expect(first.readOnly).toBe(true);
    first.value = 'Changed.';
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(value(live)).toBe(before);
  });
});

describe('accordion kind and title', () => {
  it('picks a kind from the icon and rewrites only that line', async () => {
    const { editor: live } = mount();
    const before = value(live);
    await userEvent.click(screen.getByRole('button', { name: 'Accordion kind: question' }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([...ACCORDION_KINDS]);
    expect(screen.getByRole('menuitemradio', { name: 'question' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'deep-dive' }));
    expect(value(live)).toBe(before.replace('{kind="question" title="First"}', '{kind="deep-dive" title="First"}'));
    expect(screen.queryByRole('menu')).toBeNull();
    // The cards were rebuilt; the focus is on the new kind button.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accordion kind: deep-dive' }));
  });

  it('closes the kind menu on a press outside or Escape', async () => {
    const { container } = mount();
    const kind = screen.getByRole('button', { name: 'Accordion kind: tip' });
    await userEvent.click(kind);
    // Drawn on the page body, not in the block; a press on it keeps it open.
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    await userEvent.pointer({ keys: '[MouseLeft>]', target: menu });
    expect(screen.getByRole('menu')).toBeTruthy();
    await userEvent.pointer({ keys: '[/MouseLeft]' });
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(kind);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(kind.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(kind);
  });

  it('takes its menu off the page body when the editor goes', async () => {
    const { editor: live } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Accordion kind: tip' }));
    expect(document.body.querySelector('.studio-picker-menu')).not.toBeNull();
    live.destroy();
    expect(document.body.querySelector('.studio-picker-menu')).toBeNull();
  });

  it('writes a title as typing pauses, keeps the caret and the open item', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(defined(toggles(container)[0]));
    const [first] = titles();
    await userEvent.click(first);
    first.setSelectionRange(5, 5);
    await userEvent.keyboard(' one');
    expect(value(live)).toContain('title="First"');
    await wait(300);
    expect(value(live)).toContain(':::accordion{kind="question" title="First one"}\nOne.\n:::');
    const [rebuilt] = titles();
    expect(rebuilt).not.toBe(first);
    expect(document.activeElement).toBe(rebuilt);
    expect([rebuilt.selectionStart, rebuilt.selectionEnd]).toEqual([9, 9]);
    expect(toggles(container)[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('writes a title on Enter, and Escape takes the edit back', async () => {
    const { editor: live } = mount();
    const [, second] = titles();
    await userEvent.clear(second);
    await userEvent.type(second, 'Later{Enter}');
    expect(value(live)).toContain('{kind="tip" title="Later"}');
    const [, rebuilt] = titles();
    await userEvent.type(rebuilt, ' and more{Escape}');
    await wait(300);
    expect(rebuilt.value).toBe('Later');
    expect(value(live)).toContain('{kind="tip" title="Later"}');
  });

  it('keeps the old title when the field is left empty', async () => {
    const { editor: live } = mount();
    const before = value(live);
    const [first] = titles();
    await userEvent.clear(first);
    await wait(300);
    await userEvent.click(document.body);
    expect(value(live)).toBe(before);
    expect(titles()[0].value).toBe('First');
  });

  // Telex and VNI: no write while a composition runs, and the Enter that
  // commits it (keyCode 229 in Safari) is not a submit.
  it('waits for an IME composition to end before writing a title', async () => {
    const { editor: live } = mount();
    const [first] = titles();
    first.focus();
    first.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    first.value = 'First tu';
    first.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 229 }));
    await wait(300);
    expect(value(live)).toContain('title="First"');
    expect(first.isConnected).toBe(true);
    first.value = 'First tươi';
    first.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'tươi' }));
    await wait(300);
    expect(value(live)).toContain('title="First tươi"');
  });

  it('keeps the kind and title of a locked note', async () => {
    const { editor: live } = mount();
    const before = value(live);
    live.setEditable(false);
    await userEvent.click(screen.getByRole('button', { name: 'Accordion kind: question' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const [first] = titles();
    await userEvent.click(first);
    expect(first.readOnly).toBe(true);
    first.value = 'Changed';
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(value(live)).toBe(before);
  });

  it('keeps the open items when the group is drawn again', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(defined(toggles(container)[1]));
    // The MDX button shows the source; selecting text again brings the cards back.
    await userEvent.click(screen.getByRole('button', { name: 'MDX' }));
    expect(toggles(container)).toEqual([]);
    live.commands.setTextSelection(2);
    expect(toggles(container).map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  });

  // The edit is written on the way to the button, which draws the cards
  // again under the pointer: the click still lands.
  // jsdom sends the release to the pressed node; a browser sends it to
  // whatever is under the pointer, the new button.
  it('opens the kind menu on the first click after a title edit', async () => {
    const { editor: live } = mount();
    const [first] = titles();
    await userEvent.click(first);
    await userEvent.keyboard('X');
    const kind = screen.getByRole('button', { name: 'Accordion kind: question' });
    kind.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: kind }));
    expect(value(live)).toContain('title="FirstX"');
    const again = screen.getByRole('button', { name: 'Accordion kind: question' });
    expect(again).not.toBe(kind);
    again.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(screen.getByRole('menu')).toBeTruthy();
    // A press and release on the same button is the browser's own click.
    await userEvent.click(again);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the kind menu when the group is drawn again', async () => {
    const { container, editor: live } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Accordion kind: question' }));
    const removed = vi.spyOn(document, 'removeEventListener');
    // A change from elsewhere (sync, undo) draws the group again.
    let pos = -1;
    live.state.doc.descendants((node, at) => {
      if (node.type.name === 'verbatim') pos = at;
    });
    const node = defined(live.state.doc.nodeAt(pos));
    live.view.dispatch(live.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: String(node.attrs.value).replace('Two.', 'Two!') }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(container.querySelector('.studio-accordion-kind')?.getAttribute('aria-expanded')).toBe('false');
    // Its listeners on the document went with it.
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['mousedown', 'keydown']));
  });
});
