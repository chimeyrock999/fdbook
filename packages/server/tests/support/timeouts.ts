// For a test that reads, plans or lints every note in a copy of
// content/docs: it grows with the notes and outlasts the default 5 s when
// the machine is busy (#122). Checks that can run per note use it.each
// instead (tests/features/editor/plugins/round-trip.test.ts).
export const CORPUS_TIMEOUT_MS = 30_000;
