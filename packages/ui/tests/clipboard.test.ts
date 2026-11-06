// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '#clipboard.ts';

const setClipboard = (value: unknown) => {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
};
const setExecCommand = (copy: () => boolean) => {
  const execCommand = vi.fn((command: string) => command === 'copy' && copy());
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  return execCommand;
};

afterEach(() => {
  setClipboard(undefined);
  Reflect.deleteProperty(document, 'execCommand');
  document.body.innerHTML = '';
});

// The Clipboard API exists only in a secure context: a Studio opened over
// plain http on its Tailscale address has none (#116).
describe('copyText', () => {
  it('copies through the Clipboard API where there is one', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);
    expect(await copyText('WDJB-MJHT')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('WDJB-MJHT');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('copies a selected text instead where there is none', async () => {
    let copied: string | null = null;
    setExecCommand(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(await copyText('WDJB-MJHT')).toBe(true);
    expect(copied).toBe('WDJB-MJHT');
    // Leaves nothing behind, and the focus where it was.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('falls back when the Clipboard API refuses', async () => {
    setClipboard({ writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) });
    const execCommand = setExecCommand(() => true);
    expect(await copyText('WDJB-MJHT')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('answers false when the browser blocks both', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('blocked')) });
    setExecCommand(() => false);
    expect(await copyText('WDJB-MJHT')).toBe(false);
    setExecCommand(() => { throw new Error('not supported'); });
    expect(await copyText('WDJB-MJHT')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
