// How long agent processes live. Each holds a model session, so a change
// request keeps few at once; one between turns stops once it has idled a
// while, and is the first to go when another conversation needs its place.
// A message to a conversation whose process stopped starts it again on the
// same session (connection.ts).

export const MAX_LIVE_AGENTS = 3;
export const IDLE_MS = 10 * 60_000;

export type Slot = { id: string; busy: boolean; lastMs: number };

// The process to stop so another can start: the one idle longest. None
// when every one is in a turn.
export function idlest(slots: Slot[]): string | null {
  const idle = slots.filter((slot) => !slot.busy).sort((a, b) => a.lastMs - b.lastMs);
  return idle[0]?.id ?? null;
}
