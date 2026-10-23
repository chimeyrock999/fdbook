import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { ProposalOp } from '../api/proposals';
import type { PlacedHunk } from './places';

export type SourceAct = (hunk: PlacedHunk, op: ProposalOp) => Promise<void>;

const button = (label: string, text: string, onClick: () => void, tone?: string) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = tone === undefined ? 'studio-button' : 'studio-suggest-icon';
  if (tone !== undefined) element.dataset.tone = tone;
  element.setAttribute('aria-label', label);
  element.textContent = text;
  element.addEventListener('mousedown', (event) => { event.preventDefault(); });
  element.addEventListener('click', onClick);
  return element;
};

// What a hunk puts there, as text under the lines it replaces, with its actions.
class Proposed extends WidgetType {
  constructor(readonly hunk: PlacedHunk, readonly index: number, readonly total: number, readonly act: SourceAct | null) {
    super();
  }

  eq(other: Proposed) {
    return other.hunk.key === this.hunk.key && other.hunk.hunk.added === this.hunk.hunk.added && other.hunk.stale === this.hunk.stale && other.index === this.index && other.total === this.total && (other.act === null) === (this.act === null);
  }

  toDOM() {
    const box = document.createElement('div');
    box.className = 'studio-suggest-source';
    box.setAttribute('aria-label', `Suggestion ${String(this.index)} of ${String(this.total)}`);
    const text = document.createElement('pre');
    const added = this.hunk.hunk.added.trim();
    text.textContent = added === '' ? '(removes these lines)' : added;
    box.append(text);
    const { act, hunk } = this;
    if (act !== null) {
      const acts = document.createElement('div');
      acts.className = 'studio-suggest-acts';
      // One request at a time, as on the Visual card: the buttons wait for
      // it, so a double click never sends a second one.
      const run = (op: ProposalOp) => () => {
        const buttons = [...acts.querySelectorAll('button')];
        if (buttons.some((each) => each.disabled)) return;
        for (const each of buttons) each.disabled = true;
        void act(hunk, op).finally(() => { for (const each of buttons) each.disabled = false; });
      };
      if (hunk.stale) {
        acts.append(button('Rebase suggestion', 'Rebase', run('rebase')), button('Drop suggestion', 'Drop', run('drop')));
      } else {
        acts.append(button('Accept suggestion', '✓', run('accept'), 'success'), button('Reject suggestion', '✕', run('reject'), 'error'));
      }
      box.append(acts);
    }
    return box;
  }
}

// The hunks over the Source text `text`: the lines each replaces, and under
// them what it puts there. Drawn only while the editor holds that text, so
// a keystroke between the two never misplaces them. `act` is null when the
// note is read only.
export function sourceSuggestions(text: string, hunks: PlacedHunk[], act: SourceAct | null): Extension {
  const build = (state: EditorState): DecorationSet => {
    const { doc } = state;
    if (hunks.length === 0 || doc.length !== text.length || doc.toString() !== text) return Decoration.none;
    const found: Range<Decoration>[] = [];
    hunks.forEach((hunk, index) => {
      const { removed } = hunk.hunk;
      const start = hunk.from + (removed.length - removed.trimStart().length);
      const end = hunk.to - (removed.length - removed.trimEnd().length);
      const className = `studio-suggest-line-removed${hunk.stale ? ' studio-suggest-line-stale' : ''}`;
      if (end > start) {
        for (let line = doc.lineAt(start).number; line <= doc.lineAt(end - 1).number; line += 1) {
          found.push(Decoration.line({ class: className }).range(doc.line(line).from));
        }
      }
      const at = doc.lineAt(end > start ? end - 1 : hunk.from).to;
      found.push(Decoration.widget({ widget: new Proposed(hunk, index + 1, hunks.length, act), block: true, side: 1 }).range(at));
    });
    return Decoration.set(found, true);
  };
  // A state field: block widgets may not come from a function or a plugin.
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, transaction) => (transaction.docChanged ? build(transaction.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}
