import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, type EditorView } from '@tiptap/pm/view';
import { Bug, ChevronDown, CircleDashed, CircleHelp, CirclePlay, Droplet, Leaf, Rat, Shovel, Sprout, Tag, type IconNode } from 'lucide';
import { ACCORDION_KINDS, type AccordionKind } from '@site/lib/notes-syntax';
import { icon } from '../icon';
import { floatMenu } from '../picker-menu';
import { attributes } from '../source-attributes';
import { parseAccordions, withAccordionAttributes, withAccordionBody, type AccordionItem } from './accordions';

// The site's own block directives that the editor keeps as verbatim source:
// `::::accordions` groups (components/accordion.tsx) and `::youtube`
// (components/mdx/youtube.tsx). Each becomes a card over its hidden source;
// the "MDX" button (or selecting the block) shows the source again.

// accordion.tsx: icon and callout palette per kind (lib/notes-syntax.ts).
const KINDS: Record<AccordionKind, { icon: IconNode; semantic: string }> = {
  question: { icon: CircleHelp, semantic: 'info' },
  'deep-dive': { icon: Shovel, semantic: 'example' },
  definition: { icon: Tag, semantic: 'note' },
  example: { icon: Leaf, semantic: 'example' },
  tip: { icon: Sprout, semantic: 'idea' },
  warning: { icon: Bug, semantic: 'warning' },
  danger: { icon: Rat, semantic: 'danger' },
  note: { icon: Droplet, semantic: 'note' },
};

function isAccordionKind(kind: string): kind is AccordionKind {
  return (ACCORDION_KINDS as readonly string[]).includes(kind);
}

const YOUTUBE = /^::youtube(\{[\s\S]*\})\s*$/;

export function decorateSiteDirectives(state: EditorState): Decoration[] {
  const out: Decoration[] = [];
  const { selection } = state;
  // Groups are told apart by their order in the note: which items are open
  // outlives the cards drawn for a group.
  let groups = 0;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'verbatim') return !node.isTextblock;
    const value = String(node.attrs.value);
    const group = parseAccordions(value);
    // A selected group shows its source, and still counts.
    if (selection instanceof NodeSelection && selection.from === pos) {
      if (group) groups++;
      return false;
    }
    const youtube = YOUTUBE.exec(value)?.[1];
    if (group) {
      const order = groups++;
      out.push(Decoration.widget(pos, (view, getPos) => accordionCards(view, getPos, group.items, order), {
        side: -1,
        key: `accordions:${String(order)}:${value}`,
        stopEvent: () => true,
        ignoreSelection: true,
        destroy: (dom) => { closers.get(dom)?.forEach((close) => { close(); }); },
      }));
    } else if (youtube !== undefined) {
      const attrs = attributes(youtube.slice(1, -1));
      out.push(Decoration.widget(pos, (view, getPos) => youtubeCard(view, getPos, attrs), {
        side: -1,
        key: `youtube:${value}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }));
    } else return false;
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'studio-hidden' }));
    return false;
  });
  return out;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showSource(view: EditorView, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
}

function sourceButton(view: EditorView, getPos: () => number | undefined) {
  const button = element('button', 'studio-source-button', 'MDX');
  button.type = 'button';
  button.title = 'Show the MDX source';
  button.addEventListener('click', () => { showSource(view, getPos); });
  return button;
}

// The editor's own serialize delay: a body or title is written like any
// other edit.
const WRITE_MS = 250;

// Per editor: the open items (`group:item`, by the group's order); the group
// a card is rewriting right now, which the cards drawn for it hand their
// fields to, so the focus and caret move on to the new field; and the
// button a press started on, for when the cards are drawn again under the
// pointer before the click.
type CardState = {
  open: Set<string>;
  handoff: { pos: number; fields?: Map<string, HTMLElement> } | null;
  pressed: { key: string; button: HTMLElement } | null;
};
const states = new WeakMap<EditorView, CardState>();

// One group's cards and their fields by key (`item:kind`, `item:title`, …).
type Cards = { view: EditorView; getPos: () => number | undefined; state: CardState; root: HTMLElement; fields: Map<string, HTMLElement> };

// What to undo when a group's cards are taken out: an open kind menu
// listens on the document.
const closers = new WeakMap<Node, Set<() => void>>();

// The editor serializes 250ms after an edit, or at once when it blurs. A
// card's field has already taken the focus from the editor, so a write
// from it would wait, and closing the note in that time loses it. The blur
// event (the editor is not focused) makes it serialize now.
function serializeNow(view: EditorView) {
  type Emitter = { emit: (event: 'blur', props: { editor: Emitter; event: FocusEvent; transaction: unknown }) => void };
  const editor = (view.dom as HTMLElement & { editor?: Emitter }).editor;
  editor?.emit('blur', { editor, event: new FocusEvent('blur'), transaction: view.state.tr });
}

// Rewrites the group's source, then moves the focus to field `target` of
// the rebuilt cards (drawn while the change is dispatched). Returns that
// field, or null when nothing was written.
function rewriteGroup({ view, getPos, state }: Cards, rewrite: (value: string) => string | null, target: string | undefined) {
  if (!view.editable) return null;
  const pos = getPos();
  const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
  if (pos === undefined || node?.type.name !== 'verbatim') return null;
  const value = rewrite(String(node.attrs.value));
  if (value === null || value === node.attrs.value) return null;
  const handoff: CardState['handoff'] = { pos };
  state.handoff = handoff;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value }));
  state.handoff = null;
  serializeNow(view);
  const rebuilt = target === undefined ? undefined : handoff.fields?.get(target);
  if (rebuilt?.isConnected) rebuilt.focus();
  return { rebuilt };
}

// The Enter that commits an IME candidate: Safari ends the composition
// before that keydown, which then only shows as keyCode 229.
function composingKey(event: KeyboardEvent) {
  // keyCode is deprecated, but 229 is the only sign of that Enter in Safari.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return event.isComposing || event.keyCode === 229;
}

// A title or body field: written as typing pauses and when the focus
// leaves (an input also on Enter). Each write rebuilds the cards from the
// new source, so the caret moves on to the new field (or to the field the
// focus was going to). Never during an IME composition (Telex, VNI): the
// rebuild would break it and duplicate the text; it is written when the
// composition ends. `rewrite` returns null to write nothing.
function liveField(
  cards: Cards,
  field: HTMLInputElement | HTMLTextAreaElement,
  key: string,
  rewrite: (value: string, text: string) => string | null,
) {
  const { view, root } = cards;
  register(cards, field, key);
  // The editor can be locked after the card was built.
  field.readOnly = !view.editable;
  field.addEventListener('focus', () => { field.readOnly = !view.editable; });

  let written = field.value;
  let composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { write(null); }, WRITE_MS);
  };
  const write = (next: Element | null) => {
    clearTimeout(timer);
    timer = undefined;
    if (composing || field.value === written) return;
    const text = field.value;
    const { selectionStart, selectionEnd, selectionDirection, scrollTop } = field;
    const keep = document.activeElement === field;
    const target = keep ? key : next instanceof HTMLElement ? next.dataset.accordionField : undefined;
    const done = rewriteGroup(cards, (value) => rewrite(value, text), target);
    if (!done) return;
    written = text;
    const { rebuilt } = done;
    if (keep && rebuilt && rebuilt !== field && (rebuilt instanceof HTMLInputElement || rebuilt instanceof HTMLTextAreaElement)) {
      rebuilt.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
      rebuilt.scrollTop = scrollTop;
    }
  };
  field.addEventListener('compositionstart', () => {
    composing = true;
    clearTimeout(timer);
  });
  field.addEventListener('compositionend', () => {
    composing = false;
    later();
  });
  field.addEventListener('input', (event) => {
    if (!composing && !(event as InputEvent).isComposing) later();
  });
  field.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget;
    write(next instanceof Element && root.contains(next) ? next : null);
  });
  if (field instanceof HTMLInputElement) {
    field.addEventListener('keydown', (event) => {
      if (composing || composingKey(event)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        write(null);
      } else if (event.key === 'Escape') {
        clearTimeout(timer);
        field.value = written;
      }
    });
  }
  return { revert: () => { field.value = written; } };
}

// The kind button on an item's head and its menu of the site's kinds, like
// the callout type picker.
function kindPicker(cards: Cards, item: AccordionItem, index: number) {
  const { view } = cards;
  const picker = element('span', 'studio-picker');
  const button = element('button', 'studio-picker-button studio-accordion-kind');
  button.type = 'button';
  button.title = 'Change the kind';
  button.setAttribute('aria-label', `Accordion kind: ${item.kind ?? 'none'}`);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const known = item.kind && isAccordionKind(item.kind) ? KINDS[item.kind] : undefined;
  button.append(icon(known?.icon ?? CircleDashed, 17), chevron());
  const key = `${String(index)}:kind`;
  register(cards, button, key);

  let close: (() => void) | null = null;
  const open = () => {
    const menu = element('span', 'studio-picker-menu');
    menu.setAttribute('role', 'menu');
    for (const kind of ACCORDION_KINDS) {
      const option = element('button', '');
      option.type = 'button';
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(kind === item.kind));
      option.style.color = `var(--color-callout-${KINDS[kind].semantic}-title)`;
      option.append(icon(KINDS[kind].icon, 14), element('span', '', kind));
      option.addEventListener('click', () => {
        close?.();
        rewriteGroup(cards, (value) => withAccordionAttributes(value, index, { kind }), key);
      });
      menu.append(option);
    }
    // Drawn on document.body over the note (picker-menu.ts). Escape gives
    // the focus back to the button.
    document.body.append(menu);
    button.setAttribute('aria-expanded', 'true');
    const stop = floatMenu(menu, picker, (reason) => {
      close?.();
      if (reason === 'escape') button.focus();
    });
    close = () => {
      closers.get(cards.root)?.delete(closing);
      stop();
      menu.remove();
      button.setAttribute('aria-expanded', 'false');
      close = null;
    };
    const closing = () => { close?.(); };
    const all = closers.get(cards.root) ?? new Set<() => void>();
    closers.set(cards.root, all.add(closing));
  };
  button.addEventListener('click', () => {
    if (close) close();
    else if (view.editable) open();
  });
  picker.append(button);
  return picker;
}

// A field of the cards, found again by `key` after a rebuild.
function register({ fields }: Cards, field: HTMLElement, key: string) {
  field.dataset.accordionField = key;
  fields.set(key, field);
}

function chevron() {
  const node = icon(ChevronDown, 10);
  node.classList.add('studio-picker-chevron');
  return node;
}

function accordionCards(view: EditorView, getPos: () => number | undefined, items: AccordionItem[], order: number) {
  const state = states.get(view) ?? { open: new Set<string>(), handoff: null, pressed: null };
  states.set(view, state);
  const root = element('div', 'studio-accordions');
  root.contentEditable = 'false';
  const cards: Cards = { view, getPos, state, root, fields: new Map<string, HTMLElement>() };
  if (state.handoff && state.handoff.pos === getPos()) state.handoff.fields = cards.fields;
  const { open } = state;
  replayClicks(cards, order);
  items.forEach((item, index) => {
    const kind = item.kind && isAccordionKind(item.kind) ? KINDS[item.kind] : undefined;
    const semantic = kind?.semantic ?? 'note';
    const card = element('div', 'studio-accordion');
    card.style.setProperty('--acc-title', `var(--color-callout-${semantic}-title)`);
    card.style.setProperty('--acc-line', `var(--color-callout-${semantic})`);
    card.style.setProperty('--acc-tint', `var(--color-callout-${semantic}-bg)`);
    card.style.setProperty('--acc-border', `color-mix(in oklab, var(--color-callout-${semantic}) 46%, var(--fde-border))`);

    const head = element('div', 'studio-accordion-head');
    const title = element('input', 'studio-accordion-title');
    title.value = item.title;
    title.spellcheck = false;
    title.setAttribute('aria-label', 'Accordion title');
    // An empty title is not written; leaving the field brings the last one back.
    const titleField = liveField(cards, title, `${String(index)}:title`, (value, text) =>
      text.trim() === '' ? null : withAccordionAttributes(value, index, { title: text }));
    title.addEventListener('focusout', () => { if (title.value.trim() === '') titleField.revert(); });
    const status = element('button', 'studio-accordion-state');
    status.type = 'button';
    register(cards, status, `${String(index)}:toggle`);
    head.append(kindPicker(cards, item, index), title, status);

    const body = element('div', 'studio-accordion-body');
    const source = element('textarea', 'studio-accordion-source');
    source.value = item.body;
    source.spellcheck = false;
    source.setAttribute('aria-label', `${item.title}: MDX source`);
    source.rows = Math.min(16, Math.max(3, item.body.split('\n').length + 1));
    liveField(cards, source, `${String(index)}:body`, (value, text) => withAccordionBody(value, index, text));
    body.append(source);

    const id = `${String(order)}:${String(index)}`;
    const render = () => {
      const isOpen = open.has(id);
      card.classList.toggle('is-open', isOpen);
      status.setAttribute('aria-expanded', String(isOpen));
      status.textContent = isOpen ? 'Open' : 'Show';
      body.hidden = !isOpen;
    };
    status.addEventListener('click', () => {
      if (open.has(id)) open.delete(id);
      else open.add(id);
      render();
    });
    render();
    card.append(head, body);
    root.append(card);
  });
  const source = sourceButton(view, getPos);
  register(cards, source, 'source');
  root.append(source);
  return root;
}

// A press on a card button that writes a pending title or body on its way
// (the focus leaves the field) draws the cards again before the button is
// released, so the browser sends no click. The release on the new button
// clicks it.
function replayClicks({ state, root }: Cards, order: number) {
  const pressed = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button[data-accordion-field]') : null;
    return button && root.contains(button) ? { key: `${String(order)}|${button.dataset.accordionField ?? ''}`, button } : null;
  };
  root.addEventListener('mousedown', (event) => { state.pressed = pressed(event); });
  root.addEventListener('mouseup', (event) => {
    const before = state.pressed;
    state.pressed = null;
    const now = pressed(event);
    if (now && before?.key === now.key && !before.button.isConnected) now.button.click();
  });
}

function youtubeCard(view: EditorView, getPos: () => number | undefined, attrs: Partial<Record<string, string>>) {
  const card = element('figure', 'studio-card studio-youtube');
  card.contentEditable = 'false';
  const bar = element('div', 'studio-card-bar');
  bar.append(icon(CirclePlay, 14), element('span', 'studio-card-src', attrs.url ?? 'no url'), sourceButton(view, getPos));
  const frame = element('div', 'studio-youtube-frame');
  frame.append(icon(CirclePlay, 44));
  card.append(bar, frame, element('figcaption', 'studio-card-caption', attrs.title ?? ''));
  return card;
}
