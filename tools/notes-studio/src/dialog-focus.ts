// Focus handling shared by the Studio's modal dialogs.

// Keeps Tab and Shift-Tab inside `dialog`.
export function trapFocus(dialog: HTMLElement, event: { shiftKey: boolean; preventDefault: () => void }) {
  const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

// Makes every other child of <body> inert until the returned cleanup runs,
// but the toasts (ToastStack), which say why the dialog's action failed.
// A notice in the stack that leaves the page (LeaveNotice) is inert too.
export function makeOthersInert(own: HTMLElement | null) {
  const others = [
    ...[...document.body.children].filter((child) => !(child instanceof HTMLElement && 'studioToasts' in child.dataset)),
    ...document.querySelectorAll('[data-studio-toasts] [data-leaves]'),
  ].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== own && !child.inert);
  for (const other of others) other.inert = true;
  return () => {
    for (const other of others) other.inert = false;
  };
}
