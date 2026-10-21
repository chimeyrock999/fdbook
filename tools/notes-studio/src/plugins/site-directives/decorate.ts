import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, type EditorView } from '@tiptap/pm/view';
import { Bug, CircleHelp, CirclePlay, Droplet, Leaf, Rat, Shovel, Sprout, Tag, type IconNode } from 'lucide';
import { ACCORDION_KINDS, type AccordionKind } from '@site/lib/notes-syntax';
import { icon } from '../icon';
import { attributes } from '../source-attributes';
import { parseAccordions, withAccordionBody, type AccordionItem } from './accordions';

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
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'verbatim') return !node.isTextblock;
    if (selection instanceof NodeSelection && selection.from === pos) return false;
    const value = String(node.attrs.value);
    const group = parseAccordions(value);
    const youtube = YOUTUBE.exec(value)?.[1];
    if (group) {
      out.push(Decoration.widget(pos, (view, getPos) => accordionCards(view, getPos, group.items), {
        side: -1,
        key: `accordions:${value}`,
        stopEvent: () => true,
        ignoreSelection: true,
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

// The editor's own serialize delay: a body is written like any other edit.
const WRITE_MS = 250;

// Per editor: which accordions are open, and the bodies drawn last, by group
// position and item, so a write that rebuilds the cards can hand the caret
// on to the new body.
type CardState = { open: Set<string>; bodies: Map<string, HTMLTextAreaElement> };
const states = new WeakMap<EditorView, CardState>();

// The editor serializes 250ms after an edit, or at once when it blurs. A
// body's textarea has already taken the focus from the editor, so a write
// from it would wait, and closing the note in that time loses it. The blur
// event (the editor is not focused) makes it serialize now.
function serializeNow(view: EditorView) {
  type Emitter = { emit: (event: 'blur', props: { editor: Emitter; event: FocusEvent; transaction: unknown }) => void };
  const editor = (view.dom as HTMLElement & { editor?: Emitter }).editor;
  editor?.emit('blur', { editor, event: new FocusEvent('blur'), transaction: view.state.tr });
}

function accordionCards(view: EditorView, getPos: () => number | undefined, items: AccordionItem[]) {
  const state = states.get(view) ?? { open: new Set<string>(), bodies: new Map<string, HTMLTextAreaElement>() };
  states.set(view, state);
  const { open, bodies } = state;
  const group = getPos();
  const root = element('div', 'studio-accordions');
  root.contentEditable = 'false';
  items.forEach((item, index) => {
    const kind = item.kind && isAccordionKind(item.kind) ? KINDS[item.kind] : undefined;
    const semantic = kind?.semantic ?? 'note';
    const card = element('div', 'studio-accordion');
    card.style.setProperty('--acc-title', `var(--color-callout-${semantic}-title)`);
    card.style.setProperty('--acc-line', `var(--color-callout-${semantic})`);
    card.style.setProperty('--acc-tint', `var(--color-callout-${semantic}-bg)`);
    card.style.setProperty('--acc-border', `color-mix(in oklab, var(--color-callout-${semantic}) 46%, var(--fde-border))`);

    const id = `${item.title}#${String(index)}`;
    const head = element('button', 'studio-accordion-head');
    head.type = 'button';
    if (kind) head.append(icon(kind.icon, 17));
    head.append(element('span', 'studio-accordion-title', item.title));
    const status = element('span', 'studio-accordion-state');
    head.append(status);

    const body = element('div', 'studio-accordion-body');
    const source = element('textarea', 'studio-accordion-source');
    source.value = item.body;
    source.spellcheck = false;
    source.dataset.accordion = id;
    source.setAttribute('aria-label', `${item.title}: MDX source`);
    source.rows = Math.min(16, Math.max(3, item.body.split('\n').length + 1));
    // The editor can be locked after the card was built.
    source.readOnly = !view.editable;
    source.addEventListener('focus', () => { source.readOnly = !view.editable; });
    if (group !== undefined) bodies.set(`${String(group)}|${id}`, source);

    // Written as typing pauses and when the focus leaves. Each write rebuilds
    // the cards from the new source, so the caret moves on to the new body
    // (or to the body the focus was going to). Never during an IME
    // composition (Telex, VNI): the rebuild would break it and duplicate
    // the text; it is written when the composition ends.
    let written = item.body;
    let composing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { write(null); }, WRITE_MS);
    };
    const write = (next: Element | null) => {
      clearTimeout(timer);
      timer = undefined;
      if (composing || source.value === written || !view.editable) return;
      const pos = getPos();
      const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
      if (pos === undefined || node?.type.name !== 'verbatim') return;
      written = source.value;
      const { selectionStart, selectionEnd, selectionDirection, scrollTop } = source;
      const keep = document.activeElement === source;
      const value = withAccordionBody(String(node.attrs.value), index, source.value);
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value }));
      serializeNow(view);
      const target = keep ? id : next instanceof HTMLTextAreaElement ? next.dataset.accordion : undefined;
      const rebuilt = target === undefined ? undefined : bodies.get(`${String(pos)}|${target}`);
      if (!rebuilt || rebuilt === source || !rebuilt.isConnected) return;
      rebuilt.focus();
      if (keep) {
        rebuilt.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        rebuilt.scrollTop = scrollTop;
      }
    };
    source.addEventListener('compositionstart', () => {
      composing = true;
      clearTimeout(timer);
    });
    source.addEventListener('compositionend', () => {
      composing = false;
      later();
    });
    source.addEventListener('input', (event) => {
      if (!composing && !event.isComposing) later();
    });
    source.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      write(next instanceof Element && root.contains(next) ? next : null);
    });
    body.append(source);

    const render = () => {
      const isOpen = open.has(id);
      head.setAttribute('aria-expanded', String(isOpen));
      status.textContent = isOpen ? 'Open' : 'Show';
      body.hidden = !isOpen;
    };
    head.addEventListener('click', () => {
      if (open.has(id)) open.delete(id);
      else open.add(id);
      render();
    });
    render();
    card.append(head, body);
    root.append(card);
  });
  root.append(sourceButton(view, getPos));
  return root;
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
