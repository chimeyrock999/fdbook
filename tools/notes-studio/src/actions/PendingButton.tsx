import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useShownAfter } from './busy';

export function Spinner({ size = 13 }: { size?: number }) {
  return <LoaderCircle size={size} aria-hidden className="studio-spin" />;
}

// A button that writes to the server (#138): disabled at once while its
// request runs (`pending`), and after a moment a spinner with what it is
// doing (`pendingLabel`, e.g. "Sending…"). `pendingLabel: null` swaps an
// icon button's icon for the spinner. Pair it with useBusy.
export function PendingButton({ pending, pendingLabel, disabled, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pending: boolean; pendingLabel?: ReactNode }) {
  const shown = useShownAfter(pending);
  return (
    <button type="button" {...rest} disabled={pending || disabled} aria-busy={pending || undefined}>
      {shown ? (pendingLabel === null ? <Spinner /> : <><Spinner /> {pendingLabel ?? children}</>) : children}
    </button>
  );
}
