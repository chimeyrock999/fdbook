// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontmatterForm } from '../../../src/frontmatter/FrontmatterForm';

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

// The form bound to a source string, as the editor binds it.
function Harness({ initial, onWrite }: { initial: string; onWrite: (source: string) => void }) {
  const [source, setSource] = useState(initial);
  return (
    <>
      <FrontmatterForm
        source={source}
        onSource={(next) => {
          onWrite(next);
          setSource(next);
        }}
        readOnly={false}
        onOpenSource={vi.fn()}
      />
      <button type="button" onClick={() => { setSource(source.replace('title: "Streaming"', 'title: "From disk"')); }}>
        disk change
      </button>
    </>
  );
}

afterEach(cleanup);

describe('FrontmatterForm', () => {
  it('writes each keystroke into the source and keeps the rest', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(source) => writes.push(source)} />);
    await userEvent.type(screen.getByLabelText('Title'), ' notes');
    expect(writes.at(-1)).toBe(note.replace('"Streaming"', '"Streaming notes"'));
    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Streaming notes');
  });

  it('keeps an invalid draft off the source and shows the issue', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(source) => writes.push(source)} />);
    const [graphId] = screen.getAllByLabelText('id');
    await userEvent.clear(graphId);
    expect(writes).toEqual([]);
    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Streaming');
    expect(screen.getByText(/at least 1|too small/i)).toBeTruthy();
    // Fixing it writes again.
    await userEvent.type(graphId, 'stream');
    expect(writes.at(-1)).toContain('  id: stream\n');
  });

  it('adds keywords and toggles visible', async () => {
    const writes: string[] = [];
    render(<Harness initial={note} onWrite={(source) => writes.push(source)} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Keyword' }));
    // An empty keyword breaks the schema until both fields are filled.
    expect(writes).toEqual([]);
    const ids = screen.getAllByLabelText('id');
    const names = screen.getAllByLabelText('displayName');
    await userEvent.type(ids[1], 'dag');
    await userEvent.type(names[1], 'DAG');
    expect(writes.at(-1)).toContain('  keywords:\n    - id: dag\n      displayName: DAG\n');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(writes.at(-1)).toContain('visible: false');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(writes.at(-1)).not.toContain('visible');
  });

  it('lists only issues that no field shows in the summary', async () => {
    render(<Harness initial={note.replace('title: "Streaming"', 'title: "Streaming"\nicon: 5')} onWrite={vi.fn()} />);
    await userEvent.clear(screen.getAllByLabelText('id')[0]);
    const summary = screen.getByText(/^icon: /);
    expect(summary.textContent).not.toMatch(/graph\.id/);
    expect(screen.getAllByText(/at least 1|too small/i)).toHaveLength(1);
  });

  // Off then on again ends where it started: `visible: true` stays.
  it('keeps visible: true when the box is turned off and on again', async () => {
    const source = note.replace('title: "Streaming"', 'title: "Streaming"\nvisible: true');
    const writes: string[] = [];
    render(<Harness initial={source} onWrite={(next) => writes.push(next)} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(writes.at(-1)).toContain('visible: false');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(writes.at(-1)).toBe(source);
  });

  it('follows a change made elsewhere', async () => {
    render(<Harness initial={note} onWrite={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'disk change' }));
    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('From disk');
  });

  // The editor parses source text after a pause; a visual edit in that pause
  // brings back the old block with the body edit. The form writes again.
  it('writes again when a visual edit drops the change, but not after a later revert', () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      let setOutside: (source: string) => void = vi.fn();
      function Outside() {
        const [source, setSource] = useState(note);
        setOutside = setSource;
        return (
          <FrontmatterForm
            source={source}
            onSource={(next) => {
              writes.push(next);
              setSource(next);
            }}
            readOnly={false}
            onOpenSource={vi.fn()}
          />
        );
      }
      render(<Outside />);
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Streaming notes' } });
      expect(writes).toHaveLength(1);

      act(() => {
        setOutside(`${note}typed in Visual\n`);
      });
      expect(writes.at(-1)).toBe(`${note.replace('"Streaming"', '"Streaming notes"')}typed in Visual\n`);
      expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Streaming notes');

      // Later, the old block comes back on purpose (Source, git): it stays.
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      const count = writes.length;
      act(() => {
        setOutside(note);
      });
      expect(writes).toHaveLength(count);
      expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Streaming');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends broken YAML to source mode', async () => {
    const onOpenSource = vi.fn();
    render(<FrontmatterForm source={'---\ntitle: [x\n---\n'} onSource={vi.fn()} readOnly={false} onOpenSource={onOpenSource} />);
    expect(screen.getByRole('alert').textContent).toMatch(/not valid YAML/);
    await userEvent.click(screen.getByRole('button', { name: 'Fix it in Source' }));
    expect(onOpenSource).toHaveBeenCalled();
  });

  it('is read-only when the note cannot be written', () => {
    render(<FrontmatterForm source={note} onSource={vi.fn()} readOnly onOpenSource={vi.fn()} />);
    expect(screen.getByLabelText('Title').matches(':disabled')).toBe(true);
  });
});
