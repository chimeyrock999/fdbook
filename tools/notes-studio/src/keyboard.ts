import type { KeyboardEvent } from 'react';

// Whether a keydown belongs to an IME composition (Telex, VNI). Safari ends a
// composition before the keydown of the key that ends it, so that keydown
// has isComposing false but keyCode 229.
export function composing(event: KeyboardEvent) {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode is the only signal Safari gives here
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
