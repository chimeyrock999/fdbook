import { useEffect, useMemo, useState } from 'react';
import {
  frontmatterText,
  readFrontmatter,
  writeFrontmatter,
  type FrontmatterData,
  type FrontmatterIssue,
} from './frontmatter';

// `yaml` is the block the draft belongs to. A written draft also keeps the
// block it replaced (`before`): see the effect below. `visible` is the key's
// value when the header first read this block, so turning it off and on
// again restores it.
type Draft = {
  yaml: string | null;
  before: string | null;
  visible: unknown;
  data: FrontmatterData;
  issues: FrontmatterIssue[];
};

export type Frontmatter =
  | { status: 'invalid'; error: string }
  | {
      status: 'ok';
      data: FrontmatterData;
      issues: FrontmatterIssue[];
      issueAt: (path: string) => string | undefined;
      set: (key: string, value: unknown) => void;
      setVisible: (shown: boolean) => void;
    };

// The note's frontmatter as an editable value. Each change is checked
// against the shared schema and written into the note's source only when it
// passes; until then the draft is kept with its issues. A change to the
// source from elsewhere (source mode, the disk) resets the draft.
export function useFrontmatter(source: string, onSource: (source: string) => void): Frontmatter {
  const yaml = frontmatterText(source);
  // Typing in the body re-serializes the note; the frontmatter rarely changes.
  const read = useMemo(() => readFrontmatter(yaml === null ? '' : `---\n${yaml}\n---\n`), [yaml]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The editor parses source text after a short pause (300ms), and a visual
  // edit in that pause wins: the source comes back with the old block and the
  // body edit. Write the draft again on top of it rather than lose it. Only
  // for a moment after the write, so a later revert (Source, the disk) stays.
  const dropped = draft !== null && draft.before !== draft.yaml && yaml === draft.before;
  const current = draft?.yaml === yaml || dropped ? draft : null;
  if (draft !== null && current === null) setDraft(null);
  useEffect(() => {
    if (!dropped) return;
    const result = writeFrontmatter(source, draft.data);
    if (result.issues.length === 0) onSource(result.source);
  }, [dropped, draft, source, onSource]);
  useEffect(() => {
    if (draft === null || draft.before === draft.yaml) return;
    const settle = window.setTimeout(() => {
      setDraft((latest) => (latest === draft ? { ...draft, before: draft.yaml } : latest));
    }, RETRY_MS);
    return () => {
      window.clearTimeout(settle);
    };
  }, [draft]);

  if (read.status === 'invalid') return { status: 'invalid', error: read.error };

  const data: FrontmatterData = current?.data ?? (read.status === 'ok' ? read.data : {});
  const issues = current?.issues ?? (read.status === 'ok' ? read.issues : []);
  const readVisible: unknown = current ? current.visible : read.status === 'ok' ? read.data.visible : undefined;

  const change = (next: FrontmatterData) => {
    const result = writeFrontmatter(source, next);
    if (result.issues.length === 0 && result.source !== source) onSource(result.source);
    setDraft({ yaml: frontmatterText(result.source), before: yaml, visible: readVisible, data: next, issues: result.issues });
  };
  const set = (key: string, value: unknown) => {
    change({ ...data, [key]: value });
  };
  return {
    status: 'ok',
    data,
    issues,
    issueAt: (path) => issues.find((issue) => issue.path === path)?.message,
    set,
    // Off writes `visible: false`; on again restores what the block had.
    setVisible: (shown) => {
      set('visible', shown ? (readVisible === true ? true : undefined) : false);
    },
  };
}

const RETRY_MS = 2000;
