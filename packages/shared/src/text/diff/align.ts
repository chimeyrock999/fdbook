// Which items of two lists are the same, by exact text. No imports, so the
// server (server/proposals) aligns blocks the same way as the diff view.

// The most cells the alignment table may have (a million: under 10 MB, a
// few milliseconds). A middle larger than that, a note rewritten through,
// shows as all removed then all added rather than hold up the page.
const MAX_CELLS = 1_000_000;

// Which blocks of `a` and `b` are the same, by exact text: a longest common
// subsequence, after the common start and end are taken off. On a tie a
// block of `a` goes first, so an edit shows as removed then added.
export function align(a: string[], b: string[]): ('same' | 'removed' | 'added')[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const same = (count: number) => new Array<'same'>(count).fill('same');
  if (x.length * y.length > MAX_CELLS) {
    return [...same(head), ...new Array<'removed'>(x.length).fill('removed'), ...new Array<'added'>(y.length).fill('added'), ...same(tail)];
  }
  // lengths[i][j]: the longest common subsequence of x[i..] and y[j..].
  const lengths = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = x[i] === y[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const steps: ('same' | 'removed' | 'added')[] = same(head);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      steps.push('same');
      i += 1;
      j += 1;
    } else if (j >= y.length || (i < x.length && lengths[i + 1][j] >= lengths[i][j + 1])) {
      steps.push('removed');
      i += 1;
    } else {
      steps.push('added');
      j += 1;
    }
  }
  return steps.concat(same(tail));
}
