import { ArrowUp, ExternalLink, ScrollText } from 'lucide-react';
import { useState } from 'react';
import type { BuildState, Preview, PreviewClient } from '../api/preview';
import { plural } from '../assets/asset-changes';
import { timeAgo } from './labels';
import { BUILD_LABELS } from './preview-labels';

// What the last push did, for the preview it was made on (`key`): a new
// commit or a push from elsewhere drops it.
type Result = { text: string; error: boolean; key: string };

const keyOf = (preview: Preview) => `${preview.pushed?.sha ?? ''} ${preview.unpushed.join(' ')}`;

const VERBS: Record<BuildState, string> = {
  waiting: 'Pushed',
  building: 'Building',
  ready: 'Built',
  failed: 'Build failed for',
  skipped: 'Pushed',
  none: 'Pushed',
  unknown: 'Pushed',
};

// The preview's address without the scheme, as the Changes view shows it.
const hostOf = (url: string) => url.replace(/^https?:\/\//, '');

// Why the push button is off, or what it will do.
function whyOf(preview: Preview, unsaved: string | null) {
  const count = preview.unpushed.length;
  if (unsaved !== null) return `Saving ${unsaved}…`;
  if (count === 0) return preview.pushed === null ? 'Commit a change to preview it.' : 'Everything committed is pushed.';
  if (preview.pushed === null) return `Pushes ${plural(count, 'commit')} to origin; Cloudflare builds the preview. No pull request is opened.`;
  return null;
}

// The Preview section of the Changes view (#19): pushes the change request's
// branch (no pull request) so Cloudflare Pages builds it, follows the build
// and opens the preview on `route`, the page being edited. It says when the
// preview is behind the commits, and what is not committed. A push waits
// while the open note has edits not saved yet, as a commit does.
export function PreviewSection({ client, preview, error, unsaved, route, onPushed }: {
  client: PreviewClient;
  preview: Preview | null;
  error: string | null;
  unsaved: string | null;
  // The site route of what is open (siteRoute).
  route: string;
  onPushed: (preview: Preview) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const failed = error === null ? null : <p role="alert" className="studio-changes-note studio-changes-error">Could not read the preview: {error}</p>;
  if (preview === null) return failed;
  const head = (state: BuildState | 'unpushed') => (
    <div className="studio-changes-group studio-preview-head">
      Preview <span className="studio-preview-chip" data-build={state} data-testid="preview-state">{BUILD_LABELS[state]}</span>
    </div>
  );
  if (preview.blocked !== null) {
    return (
      <section className="studio-preview" aria-label="Preview">
        {head('unpushed')}
        <p className="studio-preview-body studio-changes-why">{preview.blocked}</p>
      </section>
    );
  }

  const { build, pushed, url } = preview;
  const count = preview.unpushed.length;
  const state = build?.state ?? 'unpushed';
  const disabled = busy || unsaved !== null || count === 0;
  const label = busy ? 'Pushing…' : pushed !== null && count > 0 ? `Push ${plural(count, 'commit')}` : 'Preview';

  const push = () => {
    setBusy(true);
    setResult(null);
    client.push().then(
      (next) => {
        setResult({ text: `Pushed ${plural(count, 'commit')}. Cloudflare usually starts a build within a minute.`, error: false, key: keyOf(next) });
        onPushed(next);
      },
      (reason: unknown) => { setResult({ text: reason instanceof Error ? reason.message : String(reason), error: true, key: keyOf(preview) }); },
    ).finally(() => { setBusy(false); });
  };

  const shown = result?.key === keyOf(preview) && unsaved === null ? result : null;
  const why = shown?.text ?? whyOf(preview, unsaved);
  return (
    <section className="studio-preview" aria-label="Preview">
      {head(state)}
      {failed}
      <div className="studio-preview-body">
        {pushed === null || build === null ? (
          <p className="studio-preview-note" data-tone="quiet">Not on origin yet. Preview pushes the branch; Cloudflare Pages builds it in about 2 minutes.</p>
        ) : (
          <div className="studio-preview-url">
            {url !== null && <code title={url}>{hostOf(url)}</code>}
            <small>
              {VERBS[build.state]} <span className="font-mono">{pushed.sha.slice(0, 7)}</span>
              {build.at !== null && <> · <time dateTime={build.at} title={new Date(build.at).toLocaleString()}>{timeAgo(build.at)}</time></>}
            </small>
          </div>
        )}
        {pushed !== null && count > 0 && <p className="studio-preview-note" data-tone="warn">The preview is behind: {plural(count, 'commit')} not pushed.</p>}
        {build?.state === 'failed' && <p className="studio-preview-note" data-tone="error">The build failed. The preview still shows the last successful build. See the log.</p>}
        {build?.state === 'skipped' && (
          <p className="studio-preview-note" data-tone="quiet">Cloudflare finished this push without building it. The preview still shows the last successful build. See the log.</p>
        )}
        {build?.state === 'none' && (
          <p className="studio-preview-note" data-tone="quiet">Cloudflare has not built this push after 3 minutes. It skips pushes that change only files outside the site (tools/…).</p>
        )}
        {build?.state === 'unknown' && (
          <p className="studio-preview-note" data-tone="quiet">Could not read the build ({build.error}). The preview link still works once Cloudflare has built it.</p>
        )}
        {preview.uncommitted > 0 && (
          <p className="studio-preview-note" data-tone="quiet">
            {preview.uncommitted === 1 ? '1 file not committed: it will not be in the preview.' : `${String(preview.uncommitted)} files not committed: they will not be in the preview.`}
          </p>
        )}
        <div className="studio-preview-actions">
          <button type="button" className={`studio-button gap-1.5 ${disabled ? '' : 'studio-button-primary'}`} disabled={disabled} onClick={push}>
            <ArrowUp size={14} aria-hidden />{label}
          </button>
          {pushed !== null && url !== null && (
            <a className="studio-button gap-1.5" href={`${url}${route}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden />Open preview
            </a>
          )}
          {build?.logUrl != null && (
            <a className="studio-changes-link studio-preview-log" href={build.logUrl} target="_blank" rel="noreferrer">
              <ScrollText size={12} aria-hidden />View log
            </a>
          )}
        </div>
        {why !== null && (
          <p role={shown?.error ? 'alert' : 'status'} className="studio-changes-why" data-tone={shown === null ? undefined : shown.error ? 'error' : 'ok'}>{why}</p>
        )}
      </div>
    </section>
  );
}
