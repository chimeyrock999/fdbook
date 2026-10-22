import { useRef, useState } from 'react';

// Copies `text` from a click. The Clipboard API exists only in a secure
// context (https, or loopback), so a Studio opened over plain http on
// another address (its Tailscale IP, #116) has none: then a hidden textarea
// is selected and copied the old way. Answers whether it copied; when it
// did not, the caller selects the text for the person to copy.
export async function copyText(text: string): Promise<boolean> {
  // Typed as always there; undefined outside a secure context.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, the page not focused): try the old way.
    }
  }
  return copyBySelection(text);
}

function copyBySelection(text: string) {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.setAttribute('aria-hidden', 'true');
  // Off screen but rendered: a hidden one cannot be selected. 16px keeps iOS from zooming in.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0', fontSize: '16px' });
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  try {
    // Deprecated, and still the only way to copy outside a secure context.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus();
  }
}

// Selects the text of `node`, for the person to copy when copyText could not.
function selectText(node: Node | null) {
  const selection = window.getSelection();
  if (node === null || selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

// A Copy button's state: `copy` copies `text`; `copied` is true once it did,
// 'blocked' when the browser refused every way, the element at `ref` then
// selected for the person to copy.
export function useCopy<T extends HTMLElement>(text: string) {
  const [copied, setCopied] = useState<boolean | 'blocked'>(false);
  const ref = useRef<T>(null);
  const copy = () => {
    void copyText(text).then((done) => {
      setCopied(done || 'blocked');
      if (!done) selectText(ref.current);
    });
  };
  return { copied, ref, copy };
}
