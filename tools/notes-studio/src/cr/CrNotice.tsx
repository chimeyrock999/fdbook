import { Brush, Check, Copy, TriangleAlert } from 'lucide-react';
import type { ChangeRequest } from '../api/crs';
import { useCopy } from '../clipboard';
import { ADMIN_HINT } from '../session/session';
import { isDone, mergeCommand, plural, shortPath } from './cr-status';

// When the browser blocks copying (#116), the command is selected instead.
function CopyCommand({ command }: { command: string }) {
  const { copied, ref, copy } = useCopy<HTMLElement>(command);
  const label = copied === true ? 'Copied' : copied === 'blocked' ? 'Copying is blocked: the command is selected, copy it with Ctrl+C' : 'Copy command';
  return (
    <div className="studio-cr-command">
      <code ref={ref}>{command}</code>
      <button type="button" aria-label={label} title={label} onClick={copy}>
        {copied === true ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
    </div>
  );
}

// On top of the Changes view of the change request the page shows: once its
// pull request is merged or closed, an offer to clean it up; while main has
// moved on, how far, the files a merge would conflict in, and the command
// to merge main in a terminal. `cleanUp`: whether this person may clean it
// up, or only an admin may (it is on origin), or nobody here (a reader).
export function CrNotice({ cr, cleanUp = 'yes', onCleanUp }: { cr: ChangeRequest; cleanUp?: 'yes' | 'admin' | 'no'; onCleanUp: () => void }) {
  if (isDone(cr)) {
    const pr = cr.pr === null ? 'The pull request' : `Pull request #${String(cr.pr.number)}`;
    return (
      <div className="studio-cr-notice" data-tone="done" role="status">
        <p>
          <Check size={14} aria-hidden />
          <span>
            {cr.status === 'merged'
              ? <><b>{pr} was merged.</b> Nothing is left to do here: clean it up to remove the branch and its worktree.</>
              : <><b>{pr} was closed</b> without merging. Clean it up once it is no longer needed.</>}
          </span>
        </p>
        {cleanUp !== 'no' && (
          <div>
            <button type="button" className="studio-button studio-button-primary gap-1.5" disabled={cleanUp === 'admin'} title={cleanUp === 'admin' ? ADMIN_HINT : undefined} onClick={onCleanUp}>
              <Brush size={14} aria-hidden /> Clean up
            </button>
          </div>
        )}
      </div>
    );
  }
  if (cr.drift === null || cr.drift.behind === 0 || cr.worktree === null) return null;
  const { behind, conflicts } = cr.drift;
  const ahead = `Main is ${plural(behind, 'commit')} ahead of this change request.`;
  return (
    <div className="studio-cr-notice" data-tone={conflicts.length > 0 ? 'warning' : undefined} role="status">
      <p>
        <TriangleAlert size={14} aria-hidden />
        <span>{conflicts.length > 0 ? <><b>Conflicts with main</b> in {plural(conflicts.length, 'file')}. {ahead}</> : <>{ahead} It merges without conflicts.</>}</span>
      </p>
      {conflicts.length > 0 && (
        <ul aria-label="Conflicting files">
          {conflicts.map((path) => <li key={path} title={path}>{shortPath(path)}</li>)}
        </ul>
      )}
      <span className="studio-cr-notice-hint">{conflicts.length > 0 ? 'Merge main in a terminal, fix the conflicts, then commit:' : 'To bring it in, run in a terminal:'}</span>
      <CopyCommand command={mergeCommand(cr.worktree)} />
    </div>
  );
}
