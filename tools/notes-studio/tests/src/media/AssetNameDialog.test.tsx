// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetNameDialog } from '../../../src/media/AssetNameDialog';

afterEach(cleanup);

const request = {
  file: new File([new Uint8Array([1])], 'image.png', { type: 'image/png' }),
  dir: 'public/notes/data-modeling',
  stem: 'image',
  extension: 'png',
};

function open(assets: string[] = [], dir = request.dir) {
  const onDone = vi.fn();
  render(<AssetNameDialog request={{ ...request, dir }} assets={assets} onDone={onDone} />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'File name' });
  return { onDone, input };
}

describe('AssetNameDialog', () => {
  it('offers the suggested name, selected, with the path it will insert', () => {
    const { input } = open();
    expect(screen.getByRole('dialog', { name: 'Name this image' })).toBeTruthy();
    expect(input.value).toBe('image');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    expect(screen.getByText('.png')).toBeTruthy();
    expect(screen.getByTestId('asset-path').textContent).toBe('/notes/data-modeling/image.png');
  });

  it('saves the typed name in kebab-case on Enter', async () => {
    const { onDone } = open();
    // The suggestion is selected, so typing replaces it.
    await userEvent.keyboard('Sơ đồ kho dữ liệu{Enter}');
    expect(onDone).toHaveBeenCalledWith('so-do-kho-du-lieu');
  });

  it('blocks a name already used on this page', async () => {
    const { onDone, input } = open(['public/notes/data-modeling/image.png', 'public/notes/data-modeling/Bus.PNG']);
    expect(screen.getByRole('alert').textContent).toBe('image.png already exists on this page. Pick another name.');
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    await userEvent.type(input, '{Enter}');
    expect(onDone).not.toHaveBeenCalled();
    // The disk may not tell names apart by case.
    await userEvent.clear(input);
    await userEvent.type(input, 'bus');
    expect(save.disabled).toBe(true);
    await userEvent.type(input, '-matrix');
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(onDone).toHaveBeenCalledWith('bus-matrix');
  });

  it('compares names without case, folder included', () => {
    open(['public/notes/guides/setup/image.png'], 'public/notes/Guides/Setup');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('keeps the dialog open when Escape ends an IME composition', () => {
    const { onDone, input } = open();
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps the focus inside the dialog', async () => {
    const { input } = open();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(input);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('needs a name', async () => {
    const { onDone, input } = open();
    await userEvent.clear(input);
    await userEvent.type(input, '***{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('Type a name with letters or digits.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancels on Escape or Cancel', async () => {
    const { onDone } = open();
    await userEvent.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledWith(null);
    cleanup();
    const second = open();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(second.onDone).toHaveBeenCalledWith(null);
  });
});
