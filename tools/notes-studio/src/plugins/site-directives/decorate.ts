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

// Per editor: which accordions are open, and which body takes the focus back
// once a write has rebuilt the cards.
type CardState = { open: Set<string>; focus: string | null };
const states = new WeakMap<EditorView, CardState>();

function accordionCards(view: EditorView, getPos: () => number | undefined, items: AccordionItem[]) {
  const state = states.get(view) ?? { open: new Set<string>(), focus: null };
  states.set(view, state);
  const { open } = state;
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
    // Written when the focus leaves, not per keystroke: the cards are rebuilt
    // from the new source after each write, so the body the focus went to
    // gets it back.
    source.addEventListener('focusout', (event) => {
      if (source.value === item.body || !view.editable) return;
      const next = event.relatedTarget;
      state.focus = next instanceof HTMLTextAreaElement && root.contains(next) ? (next.dataset.accordion ?? null) : null;
      const pos = getPos();
      const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
      if (pos === undefined || node?.type.name !== 'verbatim') return;
      const value = withAccordionBody(String(node.attrs.value), index, source.value);
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value }));
    });
    body.append(source);
    if (state.focus === id) {
      state.focus = null;
      requestAnimationFrame(() => { source.focus(); });
    }

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
