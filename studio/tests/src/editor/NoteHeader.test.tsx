// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTE_ICON_NAMES } from '@site/lib/notes-icons';
import { NoteHeader } from '../../../src/editor/NoteHeader';
import { useFrontmatter } from '../../../src/frontmatter/useFrontmatter';
import type { FieldReveal } from '../../../src/frontmatter/MetadataStrip';

const note = `---
title: "Streaming"
# graph for the knowledge map
graph:
  id: streaming
  displayName: Streaming
  keywords: []
---

# Streaming
`;

// The header bound to a source string, as the editor binds it: the
// frontmatter state lives above the header, which `hide` unmounts as Source
// mode does.
function Harness({ initial, onWrite, readOnly = false, reveal = null, onLeave = vi.fn() }: {
  initial: string;
  onWrite: (source: string) => void;
  readOnly?: boolean;
  reveal?: FieldReveal | null;
  onLeave?: () => void;
}) {
  const [source, setSource] = useState(initial);
  const [shown, setShown] = useState(true);
  const frontmatter = useFrontmatter(source, (next) => {
    onWrite(next);
    setSource(next);
  });
  return (
    <>
      {shown && <NoteHeader frontmatter={frontmatter} readOnly={readOnly} onOpenSource={vi.fn()} onLeave={onLeave} reveal={reveal} />}
      <button type="button" onClick={() => { setSource(source.replace('title: "Streaming"', 'title: "From disk"')); }}>
        disk change
      </button>
      <button type="button" onClick={() => { setShown(!shown); }}>
        toggle header
      </button>
    </>
  );
}

// A header over a fixed source, for the cases that never write.
function Fixed({ source, onOpenSource = vi.fn() }: { source: string; onOpenSource?: () => void }) {
  const frontmatter = useFrontmatter(source, vi.fn());
  return <NoteHeader frontmatter={frontmatter} readOnly={false} onOpenSource={onOpenSource} onLeave={vi.fn()} reveal={null} />;
}

const details = () => userEvent.click(screen.getByRole('button', { name: /Edit details/ }));

// The server's list (server/icons/api.ts), read here as Node reads it.
// `without` drops names, as an older site lucide-react would lack them.
const iconNames = vi.hoisted(() => ({ fail: 0, without: [] as string[] }));
vi.mock('../../../src/api/icons', () => ({
  fetchIconNames: () =>
    iconNames.fail-- > 0
      ? Promise.reject(new Error('HTTP 500'))
      : Promise.resolve(NOTE_ICON_NAMES.filter((name) => !iconNames.without.includes(name))),
}));

afterEach(() => {
  cleanup();
  iconNames.fail = 0;
  iconNames.without = [];
});

describe('NoteHeader', () => {
  it('shows the title and description in place and edits them', async () => {
    const writes: string[] = [];
    render(<Harness initial={note.replace('title: "Streaming"', 'title: "Streaming"\ndescription: Kafka.')} onWrite={(s) => writes.push(s)} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Title').value).toBe('Streaming');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe('Kafka.');
    await userEvent.type(screen.getByLabelText('Title'), ' notes');
    expect(writes.at(-1)).toContain('title: "Streaming notes"\ndescription: Kafka.\n# graph for the knowledge map\n');
    await userEvent.clear(screen.getByLabelText('Description'));
    expect(writes.at(-1)).not.toContain('description');
  });

  it('moves on with Enter instead of breaking the line', async () => {
    const onLeave = vi.fn();
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(s) => writes.push(s)} onLeave={onLeave} />);
    await userEvent.type(screen.getByLabelText('Title'), '{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('Description'));
    await userEvent.type(screen.getByLabelText('Description'), 'One{Enter}');
    expect(onLeave).toHaveBeenCalledOnce();
    expect(writes.at(-1)).toContain('description: One\n');
    // A pasted line break becomes a space.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A\nB' } });
    expect(writes.at(-1)).toContain('title: "A B"');
  });

  it('sums up the rest collapsed, and edits it once opened', async () => {
    const writes: string[] = [];
    render(<Harness initial={note.replace('graph:', 'visible: false\ngraph:')} onWrite={(s) => writes.push(s)} />);
    const strip = screen.getByRole('button', { name: /Edit details/ });
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.textContent).toMatch(/Hiddenstreaming0 keywords· 0 sections/);
    expect(screen.queryByLabelText('id')).toBeNull();
    await details();
    await userEvent.click(screen.getByRole('switch', { name: 'Shown on the site' }));
    expect(writes.at(-1)).not.toContain('visible');
    await userEvent.click(screen.getByRole('switch', { name: 'Shown on the site' }));
    expect(writes.at(-1)).toContain('visible: false');
  });

  // Source mode unmounts the header; the draft lives above it.
  it('restores visible: true after the header was unmounted between off and on', async () => {
    const source = 'title: A\n# c1\nvisible: true # keep\nfull: true';
    const block = `---\n${source}\n---\n\nBody.\n`;
    const writes: string[] = [];
    render(<Harness initial={block} onWrite={(s) => writes.push(s)} />);
    await details();
    await userEvent.click(screen.getByRole('switch', { name: 'Shown on the site' }));
    expect(writes.at(-1)).toContain('visible: false # keep');
    await userEvent.click(screen.getByRole('button', { name: 'toggle header' }));
    await userEvent.click(screen.getByRole('button', { name: 'toggle header' }));
    await details();
    await userEvent.click(screen.getByRole('switch', { name: 'Shown on the site' }));
    expect(writes.at(-1)).toBe(block);
  });

  // Safari ends the composition before the keydown of the committing Enter.
  it('does not move on with the Enter that commits an IME candidate', () => {
    const onLeave = vi.fn();
    render(<Harness initial={note} onWrite={vi.fn()} onLeave={onLeave} />);
    const title = screen.getByLabelText('Title');
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter', keyCode: 229 });
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Enter', keyCode: 229 });
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('keeps an invalid draft off the source and shows the issue next to the field', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(s) => writes.push(s)} />);
    await details();
    const [graphId] = screen.getAllByLabelText('id');
    await userEvent.clear(graphId);
    expect(writes).toEqual([]);
    expect(screen.getByText(/at least 1|too small/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /1 error/ })).toBeTruthy();
    await userEvent.type(graphId, 'stream');
    expect(writes.at(-1)).toContain('  id: stream\n');
  });

  it('adds, edits and removes keyword chips', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(s) => writes.push(s)} />);
    await details();
    await userEvent.click(screen.getByRole('button', { name: '+ Keyword' }));
    // An empty keyword breaks the schema until both fields are filled.
    expect(writes).toEqual([]);
    const ids = screen.getAllByLabelText('id');
    const names = screen.getAllByLabelText('displayName');
    await userEvent.type(ids[1], 'dag');
    await userEvent.type(names[1], 'DAG');
    expect(writes.at(-1)).toContain('  keywords:\n    - id: dag\n      displayName: DAG\n');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getAllByLabelText('id')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^DAG/ }).textContent).toBe('DAGdag');
    await userEvent.click(screen.getByRole('button', { name: 'Remove keyword DAG' }));
    expect(writes.at(-1)).toContain('  keywords: []\n');
  });

  it('adds a section with its own keywords and removes the graph', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(s) => writes.push(s)} />);
    await details();
    await userEvent.click(screen.getByRole('button', { name: '+ Section' }));
    const ids = screen.getAllByLabelText('id');
    await userEvent.type(ids[1], 'consumers');
    await userEvent.type(screen.getAllByLabelText('displayName')[1], 'Consumers');
    expect(writes.at(-1)).toContain('  sections:\n    - id: consumers\n      displayName: Consumers\n');
    await userEvent.click(screen.getAllByRole('button', { name: '+ Keyword' })[1]);
    await userEvent.type(screen.getAllByLabelText('id')[2], 'offset');
    await userEvent.type(screen.getAllByLabelText('displayName')[2], 'Offset');
    expect(writes.at(-1)).toContain('      keywords:\n        - id: offset\n          displayName: Offset\n');
    await userEvent.click(screen.getByRole('button', { name: 'Remove graph' }));
    // The comment above the key goes with it.
    expect(writes.at(-1)).toBe(note.replace(/# graph[\s\S]*?---/, '---'));
  });

  it('picks, shows and removes the icon', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(s) => writes.push(s)} />);
    await details();
    await userEvent.click(screen.getByRole('button', { name: 'Choose an icon' }));
    await userEvent.type(await screen.findByPlaceholderText(/Search \d+ lucide icons/), 'brain');
    await userEvent.click(screen.getByRole('option', { name: 'Brain' }));
    // A new key goes last.
    expect(writes.at(-1)).toBe(note.replace('  keywords: []\n', '  keywords: []\nicon: Brain\n'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /Done/ }).querySelector('[title="icon: Brain"] svg')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove icon' }));
    expect(writes.at(-1)).toBe(note);
  });

  // The site's lucide-react may be older than the Studio's: BrainOff stands
  // for a name only the Studio has.
  it('offers the site\'s icons and flags any other name', async () => {
    iconNames.without = ['BrainOff'];
    vi.resetModules();
    const { NoteHeader: Fresh } = await import('../../../src/editor/NoteHeader');
    const { useFrontmatter: freshFrontmatter } = await import('../../../src/frontmatter/useFrontmatter');
    function Harness({ initial }: { initial: string; onWrite: unknown }) {
      const frontmatter = freshFrontmatter(initial, vi.fn());
      return <Fresh frontmatter={frontmatter} readOnly={false} onOpenSource={vi.fn()} onLeave={vi.fn()} reveal={null} />;
    }
    render(<Harness initial={note.replace('graph:', 'icon: BrainOff\ngraph:')} onWrite={vi.fn()} />);
    await details();
    expect(await screen.findByText('The site has no lucide icon named BrainOff.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /BrainOff/ }));
    const search = await screen.findByPlaceholderText(/Search \d+ lucide icons/);
    await userEvent.type(search, 'brain');
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))).not.toContain('BrainOff');
    expect(screen.getByRole('option', { name: 'Brain' }).querySelector('svg')).toBeTruthy();
  });

  it('shows keys it does not edit read-only and their issues', async () => {
    render(<Harness initial={note.replace('graph:', 'full: true\nicon: 5\ngraph:')} onWrite={vi.fn()} />);
    await details();
    expect(screen.getByText('full:').nextElementSibling?.textContent).toBe('true');
    expect(screen.getByText(/^icon: /).textContent).toMatch(/expected string/i);
  });

  it('follows a change made elsewhere', async () => {
    render(<Harness initial={note} onWrite={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'disk change' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Title').value).toBe('From disk');
  });

  // The editor parses source text after a pause; a visual edit in that pause
  // brings back the old block with the body edit. The header writes again.
  it('writes again when a visual edit drops the change, but not after a later revert', () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      let setOutside: (source: string) => void = vi.fn();
      function Outside() {
        const [source, setSource] = useState(note);
        setOutside = setSource;
        const frontmatter = useFrontmatter(source, (next) => {
          writes.push(next);
          setSource(next);
        });
        return <NoteHeader frontmatter={frontmatter} readOnly={false} onOpenSource={vi.fn()} onLeave={vi.fn()} reveal={null} />;
      }
      render(<Outside />);
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Streaming notes' } });
      expect(writes).toHaveLength(1);

      act(() => {
        setOutside(`${note}typed in Visual\n`);
      });
      expect(writes.at(-1)).toBe(`${note.replace('"Streaming"', '"Streaming notes"')}typed in Visual\n`);

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      const count = writes.length;
      act(() => {
        setOutside(note);
      });
      expect(writes).toHaveLength(count);
      expect(screen.getByLabelText<HTMLTextAreaElement>('Title').value).toBe('Streaming');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends broken YAML to source mode', async () => {
    const onOpenSource = vi.fn();
    render(<Fixed source={'---\ntitle: [x\n---\n'} onOpenSource={onOpenSource} />);
    expect(screen.getByRole('alert').textContent).toMatch(/not valid YAML/);
    await userEvent.click(screen.getByRole('button', { name: 'Fix it in Source' }));
    expect(onOpenSource).toHaveBeenCalled();
  });

  it('is read-only when the note cannot be written, but still opens', async () => {
    render(<Harness initial={note} onWrite={vi.fn()} readOnly />);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Title').readOnly).toBe(true);
    expect(screen.getByRole('button', { name: /Read-only/ })).toBeTruthy();
    await details();
    expect(screen.getAllByLabelText('id')[0].matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '+ Keyword' })).toBeNull();
  });

  it('starts empty for a note without frontmatter and writes a block', async () => {
    const writes: string[] = [];
    render(<Harness initial={'Body only.\n'} onWrite={(s) => writes.push(s)} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Title').placeholder).toBe('Untitled');
    expect(screen.getByRole('button', { name: /No graph/ })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Title'), 'X');
    expect(writes.at(-1)).toBe('---\ntitle: X\n---\n\nBody only.\n');
  });

  it('reveals the field at a frontmatter path', async () => {
    const source = note.replace('keywords: []', 'keywords:\n    - id: lag\n      displayName: Lag');
    const { rerender } = render(<Harness initial={source} onWrite={vi.fn()} />);
    rerender(<Harness initial={source} onWrite={vi.fn()} reveal={{ path: 'graph.keywords.0.displayName', seq: 1 }} />);
    await waitFor(() => { expect(document.activeElement).toBe(screen.getAllByLabelText('displayName')[1]); });
    rerender(<Harness initial={source} onWrite={vi.fn()} reveal={{ path: 'title', seq: 2 }} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    // A path no field edits focuses its closest parent's.
    rerender(<Harness initial={source} onWrite={vi.fn()} reveal={{ path: 'graph.keywords', seq: 3 }} />);
    await waitFor(() => { expect(document.activeElement).toBe(screen.getAllByLabelText('id')[0]); });
  });

  it('keeps line breaks in the description', async () => {
    const source = note.replace('graph:', 'description: |-\n  One.\n  Two.\ngraph:');
    const writes: string[] = [];
    render(<Harness initial={source} onWrite={(s) => writes.push(s)} />);
    await userEvent.type(screen.getByLabelText('Description'), '{Shift>}{Enter}{/Shift}Three.');
    expect(writes.at(-1)).toContain('description: |-\n  One.\n  Two.\n  Three.\n');
  });

  it('reveals a key whose name needs escaping without throwing', async () => {
    const source = note.replace('graph:', '\'a"b\': 1\ngraph:');
    const { rerender } = render(<Harness initial={source} onWrite={vi.fn()} />);
    rerender(<Harness initial={source} onWrite={vi.fn()} reveal={{ path: 'a"b', seq: 1 }} />);
    await waitFor(() => { expect(document.activeElement?.closest('.studio-strip')).toBeTruthy(); });
  });

  it('offers to load the icons again after a failure', async () => {
    // The strip's own load and the picker's both fail; a fresh module, so
    // nothing is cached from earlier tests.
    iconNames.fail = 2;
    vi.resetModules();
    const { NoteHeader: Fresh } = await import('../../../src/editor/NoteHeader');
    const { useFrontmatter: freshFrontmatter } = await import('../../../src/frontmatter/useFrontmatter');
    function Header() {
      return <Fresh frontmatter={freshFrontmatter(note, vi.fn())} readOnly={false} onOpenSource={vi.fn()} onLeave={vi.fn()} reveal={null} />;
    }
    render(<Header />);
    await details();
    await userEvent.click(screen.getByRole('button', { name: 'Choose an icon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByPlaceholderText(/Search \d+ lucide icons/)).toBeTruthy();
  });

  // Through a real note: only the title line moves.
  it('edits the title of a real note and nothing else', async () => {
    // jsdom's import.meta.url is not a file URL; tests run from the Studio root.
    const real = await readFile(join(process.cwd(), '../../content/docs/distributed-systems/mapreduce/index.mdx'), 'utf8');
    const writes: string[] = [];
    render(<Harness initial={real} onWrite={(s) => writes.push(s)} />);
    await userEvent.type(screen.getByLabelText('Title'), '!');
    expect(writes.at(-1)).toBe(real.replace('title: "MapReduce"', 'title: "MapReduce!"'));
  });
});
