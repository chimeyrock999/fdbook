// The tracks in the gap below a lifecycle row: each connector's horizontal
// run on its own line where runs would meet, ordered for the fewest
// crossings. Archify's renderers/lifecycle/render-lifecycle.mjs (MIT,
// LICENSE.archify: `assignTracks`, `countCrossings`).

export type Run<Connector extends { gap: number } = { gap: number }> = {
  // What the run belongs to, for the layout; tracks only read the numbers.
  connector: Connector;
  tops: number[];
  bottoms: number[];
  lo: number;
  hi: number;
  straight: boolean;
  track?: number;
}

// Greedy interval tracks for one gap, trying several orderings and keeping
// the one with the fewest crossings.
export function assignTracks(runs: Run[]) {
  const needs = runs.filter((run) => !run.straight);
  if (!needs.length) return 0;
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const direction = (run: Run) => (run.bottoms.length ? Math.sign(mean(run.bottoms) - mean(run.tops)) : 0);
  const start = (run: Run) => mean(run.tops);
  const byStart = (a: Run, b: Run) => (direction(a) >= 0 ? start(b) - start(a) : start(a) - start(b));
  const loopsFirst = (a: Run, b: Run) => (a.bottoms.length ? 1 : 0) - (b.bottoms.length ? 1 : 0);
  const orderings = [
    [...needs].sort((a, b) => (direction(b) - direction(a)) || byStart(a, b)),
    [...needs].sort((a, b) => (direction(a) - direction(b)) || byStart(a, b)),
    [...needs].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo)),
    [...needs].sort((a, b) => loopsFirst(a, b) || (a.hi - a.lo) - (b.hi - b.lo)),
    [...needs].sort((a, b) => -loopsFirst(a, b) || (a.hi - a.lo) - (b.hi - b.lo)),
  ];
  let best: { assignment: Map<Run, number>; crossings: number; count: number } | null = null;
  for (const ordering of orderings) {
    const tracks: Run[][] = [];
    const assignment = new Map<Run, number>();
    for (const run of ordering) {
      let track = 0;
      while (tracks[track]?.some((other) => other.lo - 10 < run.hi && run.lo < other.hi + 10)) track += 1;
      (tracks[track] ??= []).push(run);
      assignment.set(run, track);
    }
    const crossings = countCrossings(runs, assignment);
    if (!best || crossings < best.crossings || (crossings === best.crossings && tracks.length < best.count)) {
      best = { assignment, crossings, count: tracks.length };
    }
  }
  for (const run of needs) run.track = best!.assignment.get(run);
  return best!.count;
}

function countCrossings(runs: Run[], assignment: Map<Run, number>) {
  // Verticals run from the upper row (y 0) to a track, then on to the lower row (y 1000).
  const pieces = runs.map((run) => {
    const track = assignment.get(run);
    if (track === undefined) return { verticals: [[run.tops[0], 0, 1000]], horizontals: [] as number[][] };
    const y = 10 + track;
    return {
      verticals: [...run.tops.map((x) => [x, 0, y]), ...run.bottoms.map((x) => [x, y, 1000])],
      horizontals: [[y, run.lo, run.hi]],
    };
  });
  let count = 0;
  for (let left = 0; left < pieces.length; left += 1) {
    for (let right = 0; right < pieces.length; right += 1) {
      if (left === right) continue;
      for (const [x, y1, y2] of pieces[left].verticals) {
        for (const [y, x1, x2] of pieces[right].horizontals) {
          if (x > x1 + 0.5 && x < x2 - 0.5 && y > y1 && y < y2) count += 1;
        }
      }
    }
  }
  return count;
}
