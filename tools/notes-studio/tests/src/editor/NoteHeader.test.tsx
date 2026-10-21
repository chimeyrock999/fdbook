// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteHeader } from '../../../src/editor/NoteHeader';

afterEach(cleanup);

describe('NoteHeader', () => {
  it('shows the frontmatter title and description and opens the panel', async () => {
    const onOpen = vi.fn();
    render(<NoteHeader source={'---\ntitle: Fact tables\ndescription: Three kinds.\n---\n\nBody.\n'} onOpen={onOpen} />);
    const header = screen.getByRole('button', { name: /Fact tables/ });
    expect(header.textContent).toBe('Fact tablesThree kinds.');
    await userEvent.click(header);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('falls back when the frontmatter is missing or broken', () => {
    render(<NoteHeader source={'Body only.\n'} onOpen={vi.fn()} />);
    render(<NoteHeader source={'---\ntitle: [\n---\n'} onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Untitled', 'Untitled']);
  });
});
