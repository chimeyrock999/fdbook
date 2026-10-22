import { useEffect, useRef, useState } from 'react';
import type { Preview, PreviewClient } from '../api/preview';
import { plural } from '../assets/asset-changes';
import { Dialog } from '../tree/TreeDialogs';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// Publish (#20): the pull request's title and description, filled from the
// change request's name and commits and free to edit, then a push of what is
// not pushed and `gh pr create`. A failure stays in the dialog; a push that
// went through stays pushed. It cannot be closed while it publishes, so
// what the publish ends with is always shown.
export function PublishDialog({ client, preview, onPublished, onClose }: {
  client: PreviewClient;
  preview: Preview;
  onPublished: (preview: Preview) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const count = preview.unpushed.length;
  const titleInput = useRef<HTMLInputElement>(null);
  // The title is off until the draft is read and while publishing: focus it
  // each time it comes on, so focus (and Escape) stays in the dialog.
  const ready = title !== null && !busy;
  useEffect(() => {
    if (ready) titleInput.current?.focus();
  }, [ready]);

  useEffect(() => {
    let closed = false;
    client.draft().then(
      (draft) => {
        if (closed) return;
        setTitle(draft.title);
        setBody(draft.body);
      },
      (reason: unknown) => {
        if (closed) return;
        setTitle('');
        setFailed(messageOf(reason));
      },
    );
    return () => { closed = true; };
  }, [client]);

  const empty = (title ?? '').trim() === '';
  const close = () => { if (!busy) onClose(); };
  const submit = () => {
    if (title === null || empty || busy) return;
    setBusy(true);
    setFailed(null);
    client.publish(title, body).then(onPublished, (reason: unknown) => {
      setBusy(false);
      setFailed(messageOf(reason));
    });
  };

  return (
    <Dialog title="Publish as a pull request" onClose={close} onSubmit={submit}>
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">
        Opens a pull request from <code>{preview.branch}</code> to <code>main</code>.{count > 0 && ` Pushes ${plural(count, 'commit')} first.`} Later commits go to it with Update PR.
      </p>
      <label className="grid gap-1">
        <span className="studio-field-label">Title</span>
        <input ref={titleInput} className="studio-input" value={title ?? ''} disabled={title === null || busy} aria-invalid={title !== null && empty} onChange={(event) => { setTitle(event.target.value); setFailed(null); }} />
      </label>
      <label className="grid gap-1">
        <span className="studio-field-label">Description</span>
        <textarea className="studio-input studio-publish-body" rows={8} value={body} disabled={title === null || busy} onChange={(event) => { setBody(event.target.value); setFailed(null); }} />
        <span className="studio-cr-hint">{title === null ? 'Reading the commits…' : "Filled from the change request's name and its commits. Edit freely."}</span>
      </label>
      {failed !== null && <p role="alert" className="studio-tree-error">{failed}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="studio-button" disabled={busy} onClick={close}>Cancel</button>
        <button type="submit" className="studio-button studio-button-primary" disabled={title === null || empty || busy}>
          {busy ? 'Publishing…' : count > 0 ? 'Push and publish' : 'Publish'}
        </button>
      </div>
    </Dialog>
  );
}
