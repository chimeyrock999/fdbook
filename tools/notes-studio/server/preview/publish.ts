import { CommandError, git } from '../cr/git.ts';
import { previewUrlOf } from '../cr/manager.ts';
import { HttpError } from '../http.ts';
import { loadHistory } from '../git/history.ts';
import { loadPreview, pushHead, type Preview, type PreviewOptions } from './preview.ts';

// What the Publish dialog starts from: the change request's name and its
// commits, oldest first, with the branch's preview link.
export type PublishDraft = { title: string; body: string };

// GitHub's own limits are 256 and 65536 characters.
export const TITLE_MAX = 256;
export const BODY_MAX = 60_000;

const GH_FAILED = 'Could not open the pull request';

// Why the branch cannot be published now, or null. A branch gets one pull
// request: later commits go to it (Update PR), and a merged or closed one
// is cleaned up with the change request (#21), not published again.
function refusalOf(preview: Preview) {
  if (preview.blocked !== null || preview.branch === null) return preview.blocked ?? 'nothing to publish';
  if (preview.prError !== null) return `Could not read the pull request of ${preview.branch}: ${preview.prError}`;
  const { pr } = preview;
  if (pr?.state === 'OPEN') return `Pull request #${String(pr.number)} is open: push to it with Update PR.`;
  if (pr !== null) return `Pull request #${String(pr.number)} is ${pr.state.toLowerCase()}. Clean up this change request from the list.`;
  if (preview.pushed === null && preview.unpushed.length === 0) return 'Nothing to publish: commit a change first.';
  return null;
}

// The change request's name: its branch description, else the branch.
async function nameOf(root: string, branch: string) {
  const name = await git(root, 'config', '--get', `branch.${branch}.description`).catch(() => '');
  return name.trim() || branch;
}

export async function loadDraft(root: string, options: PreviewOptions): Promise<PublishDraft> {
  const preview = await loadPreview(root, options);
  if (preview.blocked !== null || preview.branch === null) throw new HttpError(409, preview.blocked ?? 'nothing to publish');
  const { commits } = await loadHistory(root);
  const lines = [...commits].reverse().map((commit) => `- ${commit.message}`);
  // Publish pushes, so the branch's preview is there once it is.
  const url = preview.url ?? (options.pagesProject === null ? null : previewUrlOf(preview.branch, options.pagesProject));
  if (url !== null) lines.push('', `Preview: ${url}`);
  return { title: await nameOf(root, preview.branch), body: lines.join('\n') };
}

function draftOf(value: Record<string, unknown>): PublishDraft {
  const { title, body } = value;
  if (typeof title !== 'string' || typeof body !== 'string') throw new HttpError(400, 'title and body must be strings');
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (trimmed === '') throw new HttpError(400, 'Give the pull request a title.');
  if (trimmed.length > TITLE_MAX) throw new HttpError(400, `The title is longer than ${String(TITLE_MAX)} characters.`);
  if (body.length > BODY_MAX) throw new HttpError(400, `The description is longer than ${String(BODY_MAX)} characters.`);
  return { title: trimmed, body };
}

// Publish: pushes what is not pushed yet, then opens a pull request from the
// change request's branch to main with gh. The pull request is read fresh
// first, so a second one is never opened. When gh fails after the push, the
// push stays and the error says so. Answers the preview with its pull request.
export async function publish(root: string, options: PreviewOptions, value: Record<string, unknown>): Promise<Preview> {
  const draft = draftOf(value);
  const before = await loadPreview(root, options, { freshPr: true });
  const refusal = refusalOf(before);
  if (refusal !== null) throw new HttpError(before.prError === null ? 409 : 502, refusal);
  const pushed = before.unpushed.length > 0;
  if (pushed) await pushHead(root, before, options);
  const head = before.branch ?? '';
  try {
    await options.pullRequests.gh.create(root, { branch: head, ...draft });
  } catch (error) {
    const reason = error instanceof CommandError && error.killed ? 'gh did not answer in time.' : (error as Error).message;
    throw new HttpError(502, `${GH_FAILED}: ${reason}${pushed ? ' The branch is pushed; try again.' : ''}`);
  } finally {
    options.pullRequests.forget(head);
  }
  return loadPreview(root, options);
}
