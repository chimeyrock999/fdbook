// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteCallout } from '#features/editor/plugins/callout/SiteCallout.tsx';
import { getSemanticCalloutType } from '@fdbook/mdx/components/notes-callout.tsx';
import { DIRECTIVE_TYPES } from '#features/editor/plugins/callout/types.ts';
import { defined } from '#tests/support/editor-state.ts';

afterEach(cleanup);

describe('SiteCallout', () => {
  // Inside the editor's root, as live; `editable` is its contenteditable.
  const draw = (type: string, setProp = vi.fn(), editable = true) =>
    render(
      <div className="ProseMirror" contentEditable={editable} suppressContentEditableWarning>
        <SiteCallout props={{ type }} literals={{}} setProp={setProp} setLiteral={vi.fn()} selected={false} types={DIRECTIVE_TYPES}>
          <div data-fde-hole="">body</div>
        </SiteCallout>
      </div>,
    );

  it('maps types onto the site palette like notes-callout.tsx', () => {
    expect(['tip', 'idea'].map(getSemanticCalloutType)).toEqual(['idea', 'idea']);
    expect(['caution', 'important', 'warn', 'warning', 'danger', 'error', 'nope'].map(getSemanticCalloutType))
      .toEqual(['caution', 'caution', 'warning', 'warning', 'danger', 'danger', 'info']);
    const { container } = draw('warn');
    const root = defined(container.querySelector<HTMLElement>('.studio-callout'));
    expect(root.style.getPropertyValue('--notes-callout-color')).toBe('var(--color-callout-warning)');
    expect(root.style.getPropertyValue('--notes-callout-title-color')).toBe('var(--color-callout-warning-title)');
  });

  it('changes the type from the icon menu', async () => {
    const setProp = vi.fn();
    draw('note', setProp);
    const icon = screen.getByRole('button', { name: 'Callout type: note' });
    // A chevron beside the icon shows it opens a menu (picker.css shows it on hover and focus).
    expect(icon.querySelector('.studio-picker-chevron')).not.toBeNull();
    await userEvent.click(icon);
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(DIRECTIVE_TYPES);
    expect(screen.getByRole('menuitemradio', { name: 'note' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'caution' }));
    expect(setProp).toHaveBeenCalledWith('type', 'caution');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('draws the menu on the page body, not in the callout block', async () => {
    const { container } = draw('note');
    await userEvent.click(screen.getByRole('button', { name: 'Callout type: note' }));
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.top).not.toBe('');
    // It goes with the callout.
    cleanup();
    expect(document.body.querySelector('.studio-picker-menu')).toBeNull();
  });

  it('closes the menu on a press outside or Escape', async () => {
    draw('note');
    const icon = screen.getByRole('button', { name: 'Callout type: note' });
    await userEvent.click(icon);
    // A press on the menu (outside the picker) keeps it open.
    await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('menu') });
    expect(screen.getByRole('menu')).toBeTruthy();
    await userEvent.pointer({ keys: '[/MouseLeft]' });
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(icon);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it('reaches the options with Tab from the icon', async () => {
    const setProp = vi.fn();
    draw('note', setProp);
    const icon = screen.getByRole('button', { name: 'Callout type: note' });
    await userEvent.click(icon);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'note' }));
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(setProp).toHaveBeenCalledWith('type', 'info');
  });

  it('opens on the checked type from the keyboard and moves with the arrow keys', async () => {
    const setProp = vi.fn();
    draw('note', setProp);
    const icon = screen.getByRole('button', { name: 'Callout type: note' });
    icon.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'note' }));
    const [first, second, third] = DIRECTIVE_TYPES;
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: first }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: third }));
    await userEvent.keyboard('{ArrowUp}{ArrowRight}{Enter}');
    expect(setProp).toHaveBeenCalledWith('type', second);
    // The menu went with the focused option: the icon has the focus back.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it('keeps the focus on the icon when the menu opens from a click', async () => {
    draw('note');
    const icon = screen.getByRole('button', { name: 'Callout type: note' });
    await userEvent.click(icon);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole('menuitemradio', { name: 'note' }));
  });

  it('keeps the type of a locked note', async () => {
    draw('note', vi.fn(), false);
    await userEvent.click(screen.getByRole('button', { name: 'Callout type: note' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
