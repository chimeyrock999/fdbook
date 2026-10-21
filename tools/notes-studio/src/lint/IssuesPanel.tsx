import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { LintIssue, LintSeverity } from '../api/lint';
import type { LintState } from './useLint';

const ICONS: Record<LintSeverity | 'ok', { Icon: LucideIcon; color: string }> = {
  error: { Icon: CircleAlert, color: 'text-[var(--fde-error)]' },
  warning: { Icon: TriangleAlert, color: 'text-[var(--fde-warning)]' },
  ok: { Icon: CircleCheck, color: 'text-[var(--fde-success)]' },
};

function SeverityIcon({ kind }: { kind: LintSeverity | 'ok' }) {
  const { Icon, color } = ICONS[kind];
  return <Icon aria-hidden className={`size-3.5 flex-none ${color}`} />;
}

function count(issues: LintIssue[], severity: LintSeverity) {
  return issues.filter((issue) => issue.severity === severity).length;
}

// Messages mark names and paths with backticks; show those as code.
function Message({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="rounded bg-[var(--fde-muted)] px-1 font-mono text-[11.5px]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

// The issue count next to the save status; opens the Issues tab.
export function IssuesChip({ state, onOpen }: { state: LintState; onOpen: () => void }) {
  const issues = state.issues;
  if (issues === null) return null;
  const errors = count(issues, 'error');
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--fde-border)] bg-[var(--fde-card)] py-0.5 pr-2.5 pl-2 text-[12.5px] ${issues.length === 0 ? 'text-[var(--fde-muted-foreground)]' : ''}`}
    >
      <SeverityIcon kind={issues.length === 0 ? 'ok' : errors > 0 ? 'error' : 'warning'} />
      {issues.length === 0 ? 'No issues' : plural(issues.length, 'issue')}
    </button>
  );
}

// The note's lint issues in file order; picking one shows it in Source.
export function IssuesPanel({ state, onSelect }: { state: LintState; onSelect: (issue: LintIssue) => void }) {
  const issues = state.issues;
  return (
    <section aria-label="Issues" className="grid content-start gap-2">
      {state.status === 'failed' && (
        <p role="alert" className="text-[12px] text-[var(--fde-error)]">
          Could not check the note: {state.error}
        </p>
      )}
      {issues === null ? (
        <p className="text-[12.5px] text-[var(--fde-muted-foreground)]">Checking…</p>
      ) : issues.length === 0 ? (
        <div className="grid justify-items-center gap-1.5 px-2 py-7 text-center text-[12.5px] text-[var(--fde-muted-foreground)]">
          <SeverityIcon kind="ok" />
          <span className="font-semibold text-[var(--fde-foreground)]">No issues</span>
          <span>This note follows the site&apos;s rules: directives, callouts, links, assets and graph ids.</span>
        </div>
      ) : (
        <>
          <p className="flex gap-3 text-[12px] text-[var(--fde-muted-foreground)]">
            <span className="inline-flex items-center gap-1">
              <SeverityIcon kind="error" />
              {plural(count(issues, 'error'), 'error')}
            </span>
            <span className="inline-flex items-center gap-1">
              <SeverityIcon kind="warning" />
              {plural(count(issues, 'warning'), 'warning')}
            </span>
          </p>
          <ul className="grid gap-1.5">
            {issues.map((issue) => (
              <li key={`${issue.rule}:${String(issue.start.offset)}:${issue.message}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(issue);
                  }}
                  className="grid w-full grid-cols-[14px_1fr] gap-x-2 gap-y-1 rounded-lg border border-[var(--fde-border)] bg-[var(--fde-background)] px-2.5 py-2 text-left text-[12.5px] hover:border-[var(--fde-muted-foreground)]"
                >
                  <SeverityIcon kind={issue.severity} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <Message text={issue.message} />
                  </span>
                  <span className="col-start-2 flex gap-2 font-mono text-[11px] text-[var(--fde-muted-foreground)]">
                    <span>Line {issue.start.line}</span>
                    <span>{issue.rule}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
